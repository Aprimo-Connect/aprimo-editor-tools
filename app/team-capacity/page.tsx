"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { Loader2, RefreshCw, ChevronDown, AlertCircle, X, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawTaskRole {
  taskRoleId?: number
  taskId?: number
  userId?: number
  userTokenId?: number
  roleId?: number
  estimatedWork?: number
  enteredEstWorkHour?: number
}

interface RawTask {
  taskId: number
  projectId?: number
  name?: string
  workFlowTaskStatus?: number
  beginDate?: string
  endDate?: string
  estimatedWork?: number
  autoClose?: number
  assignees?: { assigneeId?: number; userId?: number; roleId?: number }[]
  taskRoles?: RawTaskRole[]
  isReviewTask?: boolean
}

interface EnrichedTask extends RawTask {
  assigneeName: string
  assigneeType: "user" | "role" | "team" | "unassigned"
  weekKey: string
  dayKey: string
}

interface WeekBucket {
  key: string
  label: string
  startDate: Date
}

interface DayBucket {
  key: string
  label: string
  date: Date
}

interface RawActivity {
  activityId: number
  name?: string
  activityStateName?: string
  activityStateId?: number
  ownerId?: number
  ownerName?: string
  beginDate?: string
  endDate?: string
  visualEndDate?: string
  calendarEndDate?: string
}

interface RawProject {
  projectId: number
  title?: string
  projectStatus?: number
}

interface RawUserRole {
  roleId: number
  name: string
}

// ── Week helpers ──────────────────────────────────────────────────────────────

function getISOWeekKey(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const weekNum =
    1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`
}

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

function formatWeekLabel(start: Date): string {
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${fmt(start)} – ${fmt(end)}`
}

function toDateInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function assigneeColor(type: "user" | "role" | "team" | "unassigned"): string {
  if (type === "role") return "#7A43FA"
  if (type === "team") return "#00B2A9"
  return "var(--primary)"
}

function decodeHtml(str: string): string {
  return str.replace(/&#(\d+);?/g, (_, code) => String.fromCharCode(Number(code)))
}

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function fmtMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function buildWeeks(startDate: Date, endDate: Date): WeekBucket[] {
  const map = new Map<string, Date>()
  const cursor = getWeekStart(startDate)
  const limit = getWeekStart(endDate)
  while (cursor <= limit) {
    const key = getISOWeekKey(cursor)
    map.set(key, new Date(cursor))
    cursor.setDate(cursor.getDate() + 7)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, sd]) => ({ key, label: formatWeekLabel(sd), startDate: sd }))
}

function isBusinessDay(date: Date): boolean {
  const day = date.getDay()
  return day !== 0 && day !== 6
}

function snapToBusinessDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()
  if (day === 0) d.setDate(d.getDate() - 2) // Sunday → Friday
  if (day === 6) d.setDate(d.getDate() - 1) // Saturday → Friday
  return d
}

function buildDays(startDate: Date, endDate: Date): DayBucket[] {
  const days: DayBucket[] = []
  const cursor = new Date(startDate)
  cursor.setHours(0, 0, 0, 0)
  const limit = new Date(endDate)
  limit.setHours(0, 0, 0, 0)
  while (cursor <= limit) {
    if (isBusinessDay(cursor)) {
      const key = toDateInput(cursor)
      days.push({
        key,
        label: cursor.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        date: new Date(cursor),
      })
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

// ── Page ──────────────────────────────────────────────────────────────────────

async function productivityCall(environment: string, token: string, call: string, extra: Record<string, unknown> = {}) {
  const res = await fetch("/api/aprimo/productivity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ environment, token, call, ...extra }),
  })
  if (!res.ok) throw new Error(`API route error ${res.status}`)
  return res.json() as Promise<{ data: unknown }>
}

export default function TeamCapacityPage() {
  const { connection, isConnected } = useAprimo()
  const router = useRouter()
  const searchParams = useSearchParams()
  const hideHeader = searchParams.get("embed") === "1"

  const [rangeStart, setRangeStart] = useState<string>(() => toDateInput(getWeekStart(new Date())))
  const [rangeEnd, setRangeEnd] = useState<string>(() => {
    const d = getWeekStart(new Date())
    d.setDate(d.getDate() + 27)
    return toDateInput(d)
  })

  const [statusList, setStatusList] = useState<number[]>([])
  const [statusNameMap, setStatusNameMap] = useState<Map<number, string>>(new Map())
  const [enabledStatuses, setEnabledStatuses] = useState<Set<number>>(new Set())
  const [userNameMap, setUserNameMap] = useState<Map<number, string>>(new Map())
  const [groupNameMap, setGroupNameMap] = useState<Map<number, string>>(new Map())
  const [roleNameMap, setRoleNameMap] = useState<Map<number, string>>(new Map())
  const [userTokenNameMap, setUserTokenNameMap] = useState<Map<number, string>>(new Map())
  const fetchedUserIds = useRef<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set())
  const [activities, setActivities] = useState<RawActivity[]>([])
  const [checkedActivities, setCheckedActivities] = useState<Set<number>>(new Set())
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [activitiesError, setActivitiesError] = useState<string | null>(null)

  const [projects, setProjects] = useState<RawProject[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectStatusList, setProjectStatusList] = useState<number[]>([])
  const [projectStatusNameMap, setProjectStatusNameMap] = useState<Map<number, string>>(new Map())
  const [enabledProjectStatuses, setEnabledProjectStatuses] = useState<Set<number>>(new Set())

  const [checkedProjects, setCheckedProjects] = useState<Set<number>>(new Set())
  const [tasksByProject, setTasksByProject] = useState<Map<number, RawTask[]>>(new Map())
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [projectToActivityId, setProjectToActivityId] = useState<Map<number, number>>(new Map())
  const [selectedTask, setSelectedTask] = useState<EnrichedTask | null>(null)
  const [checkedAssignees, setCheckedAssignees] = useState<Set<string>>(new Set())
  const [modalMembers, setModalMembers] = useState<{
    loading: boolean
    users: Array<{ userId: number; firstName: string; lastName: string; email?: string }>
    taskRoleId?: number
    error: string | null
  }>({ loading: false, users: [], error: null })
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [modalTaskDetail, setModalTaskDetail] = useState<any>(null)
  const [modalProjectRoleUser, setModalProjectRoleUser] = useState<string | null>(null)
  const [modalActivityRoleUser, setModalActivityRoleUser] = useState<string | null>(null)
  const [userSearchQuery, setUserSearchQuery] = useState("")
  const [userSearchResults, setUserSearchResults] = useState<Array<{ userId: number; firstName: string; lastName: string }>>([])
  const [userSearchLoading, setUserSearchLoading] = useState(false)
  const [userSearchError, setUserSearchError] = useState<string | null>(null)
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [viewMode, setViewMode] = useState<"week" | "day">("week")

  useEffect(() => {
    if (!isConnected) router.replace("/")
  }, [isConnected, router])

  const resolveAssignees = useCallback(async (
    environment: string,
    accessToken: string,
    tasks: RawTask[],
  ) => {
    const allIds = tasks.flatMap(t => [
      ...(t.assignees ?? []).filter(a => a.userId != null).map(a => a.userId as number),
      ...(t.taskRoles ?? []).filter(r => r.userId != null).map(r => r.userId as number),
    ])
    const uniqueNew = [...new Set(allIds)].filter(id => !fetchedUserIds.current.has(id))
    if (uniqueNew.length === 0) return
    uniqueNew.forEach(id => fetchedUserIds.current.add(id))
    await Promise.all(
      uniqueNew.map(async (userId) => {
        try {
          const { data } = await productivityCall(environment, accessToken, "users.getById", { id: userId })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const u = data as any
          if (u) {
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || String(userId)
            setUserNameMap(prev => new Map(prev).set(userId, name))
            return
          }
          // Not a user — try groups
          const { data: gData } = await productivityCall(environment, accessToken, "groups.getById", { id: userId })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const g = gData as any
          const name = g?.name || `Group ${userId}`
          setGroupNameMap(prev => new Map(prev).set(userId, name))
        } catch {
          setUserNameMap(prev => new Map(prev).set(userId, `User ${userId}`))
        }
      })
    )
  }, [])

  const fetchTasksForProjects = useCallback(async (projectIds: number[]) => {
    if (!connection) return
    if (projectIds.length === 0) { setTasksByProject(new Map()); return }
    const { environment, accessToken } = connection
    setLoadingTasks(true)
    setTasksError(null)
    try {
      const entries = await Promise.all(
        projectIds.map(async (projectId) => {
          const tasks: RawTask[] = []
          const limit = 200
          let offset = 0
          while (tasks.length < 1000) {
            const { data } = await productivityCall(environment, accessToken, "tasks.getByProjectId", {
              id: projectId,
              params: { limit, offset },
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const d = data as any
            const items: RawTask[] = d?._embedded?.Task ?? d?._embedded?.tasks ?? d?.items ?? []
            tasks.push(...items)
            const total: number = d?._total ?? items.length
            if (tasks.length >= total || items.length < limit) break
            offset += limit
          }
          // Fetch review tasks for this project
          const reviewTasks: RawTask[] = []
          let rtOffset = 0
          while (reviewTasks.length < 1000) {
            const { data: rtData } = await productivityCall(environment, accessToken, "review-tasks.search", {
              request: { equals: { fieldName: "projectId", fieldValue: projectId } },
              params: { limit, offset: rtOffset },
            })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rd = rtData as any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rtItems: RawTask[] = (rd?._embedded?.ReviewTask ?? []).map((rt: any) => ({ ...rt, isReviewTask: true as const }))
            reviewTasks.push(...rtItems)
            const rtTotal: number = rd?._total ?? rtItems.length
            if (reviewTasks.length >= rtTotal || rtItems.length < limit) break
            rtOffset += limit
          }
          tasks.push(...reviewTasks)
          await resolveAssignees(environment, accessToken, tasks)
          return [projectId, tasks] as [number, RawTask[]]
        })
      )
      setTasksByProject(new Map(entries))
    } catch (err) {
      setTasksError(err instanceof Error ? err.message : "Failed to load tasks")
    } finally {
      setLoadingTasks(false)
    }
  }, [connection, resolveAssignees])

  const fetchActivities = useCallback(async () => {
    if (!connection) return
    const { environment, accessToken } = connection
    setLoadingActivities(true)
    setActivitiesError(null)
    setActivities([])
    try {
      // Fetch all activities (paged)
      const collected: RawActivity[] = []
      const limit = 200
      let offset = 0
      while (collected.length < 1000) {
        const { data } = await productivityCall(environment, accessToken, "activities.get", {
          params: { limit, offset },
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = data as any
        const items: RawActivity[] = d?._embedded?.Activity ?? d?._embedded?.activities ?? d?.items ?? []
        collected.push(...items)
        const total: number = d?._total ?? items.length
        if (collected.length >= total || items.length < limit) break
        offset += limit
      }
      setActivities(collected)
    } catch (err) {
      setActivitiesError(err instanceof Error ? err.message : "Failed to load activities")
    } finally {
      setLoadingActivities(false)
    }
  }, [connection])

  const fetchAll = useCallback(async () => {
    if (!connection) return
    const { environment, accessToken } = connection
    setTasksByProject(new Map())
    setProjects([])
    setCheckedActivities(new Set())
    setCheckedProjects(new Set())
    setExpandedCells(new Set())
    setStatusList([])
    setError(null)

    // Load lookup 2974 for task + project status names/filter
    try {
      const { data } = await productivityCall(environment, accessToken, "lookupLists.getById", { id: 2974 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: { key: number; value: string }[] = (data as any)?.items ?? []
      const ids = items.map(i => i.key)
      const nameMap = new Map(items.map(i => [i.key, i.value]))
      setStatusNameMap(nameMap)
      setProjectStatusNameMap(nameMap)
      setStatusList(ids)
      setProjectStatusList(ids)
      setEnabledStatuses(new Set(ids.slice(0, 4)))
      setEnabledProjectStatuses(new Set(ids.slice(0, 4)))
    } catch {
      setError("Failed to load status list")
      return
    }

    // Load all user roles for role-assignee display
    try {
      const collected: RawUserRole[] = []
      const limit = 200
      let offset = 0
      while (collected.length < 500) {
        const { data } = await productivityCall(environment, accessToken, "userRoles.get", {
          params: { limit, offset },
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = data as any
        const items: RawUserRole[] = d?._embedded?.["user-role"] ?? d?._embedded?.["user-roles"] ?? d?.items ?? []
        collected.push(...items)
        const total: number = d?._total ?? items.length
        if (collected.length >= total || items.length < limit) break
        offset += limit
      }
      setRoleNameMap(new Map(collected.map(r => [r.roleId, r.name])))
    } catch {
      // roles are optional — don't block on failure
    }

    // Load lookup 2981 for user token names
    try {
      const { data } = await productivityCall(environment, accessToken, "lookupLists.getById", { id: 2981 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: { key: number; value: string }[] = (data as any)?.items ?? []
      setUserTokenNameMap(new Map(items.map(i => [i.key, decodeHtml(i.value)])))
    } catch {
      // user tokens are optional
    }

    await fetchActivities()
  }, [connection, fetchActivities])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])


  const fetchProjectsForActivities = useCallback(async (activityIds: number[]) => {
    if (!connection) return
    if (activityIds.length === 0) { setProjects([]); return }
    const { environment, accessToken } = connection
    setLoadingProjects(true)
    setProjectsError(null)
    try {
      const batches = await Promise.all(
        activityIds.map(async (activityId) => {
          const { data } = await productivityCall(environment, accessToken, "projects.getByActivityId", { id: activityId })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const d = data as any
          const ps = (d?._embedded?.Project ?? d?._embedded?.projects ?? d?.items ?? []) as RawProject[]
          return { activityId, projects: ps }
        })
      )
      const seen = new Set<number>()
      const unique: RawProject[] = []
      const p2a = new Map<number, number>()
      for (const { activityId, projects: ps } of batches) {
        for (const p of ps) {
          p2a.set(p.projectId, activityId)
          if (!seen.has(p.projectId)) { seen.add(p.projectId); unique.push(p) }
        }
      }
      setProjectToActivityId(p2a)
      setProjects(unique)
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Failed to load projects")
    } finally {
      setLoadingProjects(false)
    }
  }, [connection])

  useEffect(() => {
    fetchProjectsForActivities([...checkedActivities])
  }, [checkedActivities, fetchProjectsForActivities])

  useEffect(() => {
    fetchTasksForProjects([...checkedProjects])
  }, [checkedProjects, fetchTasksForProjects])

  useEffect(() => {
    if (!selectedTask || !connection) {
      setModalMembers({ loading: false, users: [], error: null })
      setModalProjectRoleUser(null)
      setModalActivityRoleUser(null)
      return
    }
    const { assigneeType, assignees = [], taskRoles = [] } = selectedTask
    if (assigneeType !== "team" && assigneeType !== "role") {
      setModalMembers({ loading: false, users: [], error: null })
      setModalProjectRoleUser(null)
      setModalActivityRoleUser(null)
      return
    }
    const { environment, accessToken } = connection
    setSelectedMemberId(null)
    setAssignError(null)

    if (assigneeType === "role") {
      let roleId: number | undefined
      for (const a of assignees) {
        if (a.roleId != null) { roleId = a.roleId; break }
      }
      if (roleId === undefined) {
        for (const r of taskRoles) {
          if (r.roleId != null) { roleId = r.roleId; break }
        }
      }
      if (roleId === undefined || !selectedTask.projectId) return
      const capturedRoleId = roleId
      const capturedProjectId = selectedTask.projectId
      const activityId = projectToActivityId.get(capturedProjectId)
      setModalMembers({ loading: true, users: [], error: null })
      setModalProjectRoleUser(null)
      setModalActivityRoleUser(null)
      ;(async () => {
        try {
          const [projectRolesRes, activityRolesRes] = await Promise.allSettled([
            productivityCall(environment, accessToken, "userRoles.getProjectRoleMemberships", { id: capturedProjectId }),
            activityId != null
              ? productivityCall(environment, accessToken, "activities.getRoleMemberships", { id: activityId })
              : Promise.resolve(null),
          ])

          // Project role assignment: { roles: [{ roleId, userId }] } — multiple entries per role possible
          if (projectRolesRes.status === "fulfilled") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pd = projectRolesRes.value?.data as any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const projectMatches: number[] = (pd?.roles ?? []).filter((r: any) => r.roleId === capturedRoleId && r.userId != null).map((r: any) => r.userId)
            if (projectMatches.length > 0) {
              setModalProjectRoleUser(projectMatches.map(uid => userNameMap.get(uid) ?? `User ${uid}`).join(", "))
            }
          }

          // Activity roles: _embedded["activity-role"][x] where userRole.roleId matches
          // Members come from userRole.users; assigned comes from users[0].user
          if (activityRolesRes.status === "fulfilled" && activityRolesRes.value != null) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ad = (activityRolesRes.value as any)?.data as any
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const activityRoleItems: any[] = ad?._embedded?.["activity-role"] ?? []
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const activityMatch = activityRoleItems.find((r: any) => r.userRole?.roleId === capturedRoleId)

            // Members: userRole.users resolved via userNameMap
            if (activityMatch) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const memberIds: number[] = (activityMatch.userRole?.users ?? []).map((u: any) => u.userId).filter((id: unknown): id is number => typeof id === "number")
              const resolvedUsers = memberIds.map(uid => {
                const name = userNameMap.get(uid)
                const parts = name?.split(" ") ?? []
                return { userId: uid, firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") || String(uid) }
              })
              const taskRoleId = taskRoles.find(r => r.roleId === capturedRoleId)?.taskRoleId
              setModalMembers({ loading: false, users: resolvedUsers, taskRoleId, error: null })

              // Activity assigned: users[].user — may be multiple
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const assignedUsers: any[] = (activityMatch.users ?? []).map((u: any) => u.user).filter(Boolean)
              if (assignedUsers.length > 0) {
                const names = assignedUsers.map((u: any) =>
                  u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : (userNameMap.get(u.userId) ?? `User ${u.userId}`)
                )
                setModalActivityRoleUser(names.join(", "))
              }
            } else {
              setModalMembers({ loading: false, users: [], error: null })
            }
          } else {
            setModalMembers({ loading: false, users: [], error: null })
          }
        } catch (err) {
          setModalMembers({ loading: false, users: [], error: err instanceof Error ? err.message : "Failed to load members" })
        }
      })()
      return
    }

    // Group: fetch member IDs from groups.getById, then resolve each via users.getById
    let groupId: number | undefined
    for (const a of assignees) {
      if (a.userId != null && groupNameMap.has(a.userId)) { groupId = a.userId; break }
    }
    if (groupId === undefined) {
      for (const r of taskRoles) {
        if (r.userId != null && groupNameMap.has(r.userId)) { groupId = r.userId; break }
      }
    }
    if (groupId === undefined) return
    setModalMembers({ loading: true, users: [], error: null })
    ;(async () => {
      try {
        const { data } = await productivityCall(environment, accessToken, "groups.getById", { id: groupId })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = data as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawUsers: any[] = d?._embedded?.User ?? d?._embedded?.users ?? d?.users ?? d?.members ?? []
        const userIds: number[] = rawUsers
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((u: any) => u.userId ?? u.id)
          .filter((id: unknown): id is number => typeof id === "number")
        const resolvedUsers = await Promise.all(
          userIds.map(async (userId) => {
            try {
              const { data: uData } = await productivityCall(environment, accessToken, "users.getById", { id: userId })
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const u = uData as any
              return {
                userId,
                firstName: (u?.firstName ?? "") as string,
                lastName: (u?.lastName ?? "") as string,
                email: u?.email as string | undefined,
              }
            } catch {
              return { userId, firstName: "", lastName: String(userId), email: undefined }
            }
          })
        )
        const taskRoleId = selectedTask?.taskRoles?.find(r => r.userId === groupId)?.taskRoleId
        setModalMembers({ loading: false, users: resolvedUsers, taskRoleId, error: null })
      } catch (err) {
        setModalMembers({ loading: false, users: [], error: err instanceof Error ? err.message : "Failed to load members" })
      }
    })()
  }, [selectedTask, connection, groupNameMap, projectToActivityId, userNameMap])

  useEffect(() => {
    if (!selectedTask || !connection) { setModalTaskDetail(null); return }
    const { environment, accessToken } = connection
    const detailCall = selectedTask.isReviewTask ? "review-tasks.getById" : "tasks.getById"
    productivityCall(environment, accessToken, detailCall, { id: selectedTask.taskId })
      .then(({ data }) => setModalTaskDetail(data))
      .catch(() => setModalTaskDetail(null))
  }, [selectedTask, connection])

  function toggleStatus(statusId: number) {
    setEnabledStatuses(prev => {
      const n = new Set(prev)
      n.has(statusId) ? n.delete(statusId) : n.add(statusId)
      return n
    })
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const filteredActivities = useMemo(() => {
    const included: typeof activities = []
    const excluded: typeof activities = []
    for (const a of activities) {
      const latestEnd = [a.endDate, a.visualEndDate, a.calendarEndDate].filter(Boolean).sort().at(-1)
      const rangeStartBeforeEnd = latestEnd ? rangeStart <= latestEnd : true
      const rangeEndAfterStart = a.beginDate ? rangeEnd >= a.beginDate : true
      if (rangeStartBeforeEnd && rangeEndAfterStart) {
        included.push(a)
      } else {
        excluded.push(a)
      }
    }
    return included
  }, [activities, rangeStart, rangeEnd])

  const allTasks = useMemo<RawTask[]>(() => {
    const out: RawTask[] = []
    for (const [, tasks] of tasksByProject) {
      out.push(...tasks.filter(t => t.autoClose !== 1))
    }
    if (statusList.length > 0 && enabledStatuses.size < statusList.length) {
      return out.filter(t => t.workFlowTaskStatus === undefined || enabledStatuses.has(t.workFlowTaskStatus))
    }
    return out
  }, [tasksByProject, enabledStatuses, statusList])

  const weeks = useMemo(() => buildWeeks(parseLocalDate(rangeStart), parseLocalDate(rangeEnd)), [rangeStart, rangeEnd])
  const weekKeySet = useMemo(() => new Set(weeks.map(w => w.key)), [weeks])
  const days = useMemo(() => buildDays(parseLocalDate(rangeStart), parseLocalDate(rangeEnd)), [rangeStart, rangeEnd])
  const dayKeySet = useMemo(() => new Set(days.map(d => d.key)), [days])
  const currentWeekKey = getISOWeekKey(new Date())
  const currentDayKey = toDateInput(new Date())


  const enriched = useMemo<EnrichedTask[]>(() =>
    allTasks.flatMap(t => {
      const dateStr = t.endDate ?? t.beginDate
      const taskDate = dateStr ? new Date(dateStr) : null
      const rawWeekKey = taskDate ? getISOWeekKey(taskDate) : "unscheduled"
      const weekKey = rawWeekKey === "unscheduled" || weekKeySet.has(rawWeekKey) ? rawWeekKey : "unscheduled"
      const snappedDate = taskDate ? snapToBusinessDay(taskDate) : null
      const rawDayKey = snappedDate ? toDateInput(snappedDate) : "unscheduled"
      const dayKey = (snappedDate && rawDayKey !== "unscheduled" && dayKeySet.has(rawDayKey)) ? rawDayKey : "unscheduled"
      const hasAssignees = t.assignees && t.assignees.length > 0
      if (hasAssignees) {
        return (t.assignees as { userId?: number; roleId?: number }[]).map(a => {
          let assigneeName: string
          let assigneeType: EnrichedTask["assigneeType"]
          if (a.userId != null) {
            if (groupNameMap.has(a.userId)) {
              assigneeName = groupNameMap.get(a.userId)!
              assigneeType = "team"
            } else {
              assigneeName = userNameMap.get(a.userId) ?? `User ${a.userId}`
              assigneeType = "user"
            }
          } else if (a.roleId != null) {
            assigneeName = roleNameMap.get(a.roleId) ?? `Role ${a.roleId}`
            assigneeType = "role"
          } else {
            assigneeName = "Unassigned"
            assigneeType = "unassigned"
          }
          return { ...t, assigneeName, assigneeType, weekKey, dayKey }
        })
      }
      const roleList = t.taskRoles && t.taskRoles.length > 0 ? t.taskRoles : [{}]
      return roleList.map(r => {
        let assigneeName: string
        let assigneeType: EnrichedTask["assigneeType"]
        if (r.userId != null) {
          if (groupNameMap.has(r.userId)) {
            assigneeName = groupNameMap.get(r.userId)!
            assigneeType = "team"
          } else {
            assigneeName = userNameMap.get(r.userId) ?? `User ${r.userId}`
            assigneeType = "user"
          }
        } else if (r.roleId != null) {
          assigneeName = roleNameMap.get(r.roleId) ?? `Role ${r.roleId}`
          assigneeType = "role"
        } else if (r.userTokenId != null) {
          assigneeName = userTokenNameMap.get(r.userTokenId) ?? `Token ${r.userTokenId}`
          assigneeType = "role"
        } else {
          assigneeName = "Unassigned"
          assigneeType = "unassigned"
        }
        const estimatedWork = r.estimatedWork ?? t.estimatedWork
        return { ...t, estimatedWork, assigneeName, assigneeType, weekKey, dayKey }
      })
    }),
    [allTasks, userNameMap, groupNameMap, roleNameMap, userTokenNameMap, weekKeySet, dayKeySet]
  )

  const TYPE_ORDER: Record<EnrichedTask["assigneeType"], number> = { user: 0, role: 1, team: 2, unassigned: 3 }

  const assigneeRows = useMemo(() => {
    const map = new Map<string, EnrichedTask["assigneeType"]>()
    for (const t of enriched) {
      if (!map.has(t.assigneeName)) map.set(t.assigneeName, t.assigneeType)
    }
    return [...map.entries()]
      .map(([name, type]) => ({ name, type }))
      .sort((a, b) => {
        const od = TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
        return od !== 0 ? od : a.name.localeCompare(b.name)
      })
  }, [enriched]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-check any newly discovered assignees
  useEffect(() => {
    setCheckedAssignees(prev => {
      let changed = false
      const next = new Set(prev)
      for (const { name } of assigneeRows) {
        if (!next.has(name)) { next.add(name); changed = true }
      }
      return changed ? next : prev
    })
  }, [assigneeRows])

  // Sync checked activities with the filtered list: auto-check new ones, drop out-of-range ones
  useEffect(() => {
    if (activities.length === 0) return
    setCheckedActivities(prev => {
      const filteredIds = new Set(filteredActivities.map(a => a.activityId))
      let changed = false
      const next = new Set<number>()
      for (const id of prev) {
        if (filteredIds.has(id)) next.add(id)
        else changed = true
      }
      for (const a of filteredActivities) {
        if (!next.has(a.activityId)) { next.add(a.activityId); changed = true }
      }
      return changed ? next : prev
    })
  }, [filteredActivities, activities.length])

  // Sync checked projects with the current project list: drop removed, auto-check new ones
  useEffect(() => {
    const visible = projects.filter(p => p.projectStatus === undefined || enabledProjectStatuses.has(p.projectStatus))
    const visibleIds = new Set(visible.map(p => p.projectId))
    setCheckedProjects(prev => {
      let changed = false
      const next = new Set<number>()
      for (const id of prev) {
        if (visibleIds.has(id)) next.add(id)
        else changed = true
      }
      for (const p of visible) {
        if (!next.has(p.projectId)) { next.add(p.projectId); changed = true }
      }
      return changed ? next : prev
    })
  }, [projects, enabledProjectStatuses])

  const weekTotals = useMemo(() =>
    new Map(weeks.map(w => [
      w.key,
      enriched
        .filter(t => checkedAssignees.has(t.assigneeName) && t.weekKey === w.key)
        .reduce((s, t) => s + (t.estimatedWork ?? 0), 0),
    ])),
    [enriched, checkedAssignees, weeks]
  )

  const unscheduledTotal = useMemo(() =>
    enriched
      .filter(t => checkedAssignees.has(t.assigneeName) && t.weekKey === "unscheduled")
      .reduce((s, t) => s + (t.estimatedWork ?? 0), 0),
    [enriched, checkedAssignees]
  )

  const dayTotals = useMemo(() =>
    new Map(days.map(d => [
      d.key,
      enriched
        .filter(t => checkedAssignees.has(t.assigneeName) && t.dayKey === d.key)
        .reduce((s, t) => s + (t.estimatedWork ?? 0), 0),
    ])),
    [enriched, checkedAssignees, days]
  )

  const unscheduledDayTotal = useMemo(() =>
    enriched
      .filter(t => checkedAssignees.has(t.assigneeName) && t.dayKey === "unscheduled")
      .reduce((s, t) => s + (t.estimatedWork ?? 0), 0),
    [enriched, checkedAssignees]
  )

  function getCellTasks(assignee: string, key: string) {
    return viewMode === "day"
      ? enriched.filter(t => t.assigneeName === assignee && t.dayKey === key)
      : enriched.filter(t => t.assigneeName === assignee && t.weekKey === key)
  }

  function getUnscheduled(assignee: string) {
    return viewMode === "day"
      ? enriched.filter(t => t.assigneeName === assignee && t.dayKey === "unscheduled")
      : enriched.filter(t => t.assigneeName === assignee && t.weekKey === "unscheduled")
  }

  function toggleCell(key: string) {
    setExpandedCells(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  useEffect(() => {
    setUserSearchQuery("")
    setUserSearchResults([])
    setUserSearchError(null)
    setSelectedMemberId(null)
  }, [selectedTask])

  function handleUserSearchInput(query: string) {
    setUserSearchQuery(query)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    if (query.length < 2) { setUserSearchResults([]); return }
    searchDebounce.current = setTimeout(async () => {
      if (!connection) return
      const { environment, accessToken } = connection
      setUserSearchLoading(true)
      setUserSearchError(null)
      try {
        const { data } = await productivityCall(environment, accessToken, "users.search", {
          request: { contains: { fieldName: "lastName", fieldValue: query } },
          params: { limit: 20 },
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d = data as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const embedded = d?._embedded ?? {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items: any[] = embedded.User ?? embedded.user ?? embedded.users ?? embedded.Users ?? d?.items ?? (Array.isArray(d) ? d : [])
        setUserSearchResults(items.map((u: { userId?: number; id?: number; firstName?: string; lastName?: string }) => ({
          userId: (u.userId ?? u.id) as number,
          firstName: u.firstName ?? "",
          lastName: u.lastName ?? "",
        })))
      } catch (err) {
        setUserSearchError(err instanceof Error ? err.message : "Search failed")
      } finally {
        setUserSearchLoading(false)
      }
    }, 300)
  }

  async function assignUser() {
    if (!selectedTask || !connection || selectedMemberId === null) return
    const { environment, accessToken } = connection
    setAssigning(true)
    setAssignError(null)
    try {
      const ft = modalTaskDetail
      if (!ft?._links?.delegate) { setAssignError("This task cannot be delegated in its current state"); return }
      const ftAssignee = ft?.assignees?.find((a: { assigneeId?: number }) => a.assigneeId != null)
      if (!ftAssignee?.assigneeId) { setAssignError("Task has no active assignee — it may not have been accepted yet"); return }
      if (selectedMemberId === ftAssignee.userId) { setAssignError("Cannot delegate to the current assignee"); return }
      const taskAssigneeId = ftAssignee.assigneeId

      await productivityCall(environment, accessToken, "tasks.delegate", {
        id: selectedTask.taskId,
        body: { taskAssigneeId, newUserId: selectedMemberId },
      })
      setSelectedTask(null)
      fetchTasksForProjects([...checkedProjects])
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      if (msg.includes("409") || msg.includes("conflicting")) {
        setAssignError("Cannot delegate to this user — they may already be assigned or cannot receive delegations")
      } else {
        setAssignError(msg || "Failed to delegate")
      }
    } finally {
      setAssigning(false)
    }
  }

  async function assignMember() {
    if (!selectedTask || !connection || selectedMemberId === null) return
    const { environment, accessToken } = connection
    setAssigning(true)
    setAssignError(null)
    try {
      const ft2 = modalTaskDetail
      if (!ft2?._links?.delegate) { setAssignError("This task cannot be delegated in its current state"); return }
      const ftAssignee2 = ft2?.assignees?.find((a: { assigneeId?: number }) => a.assigneeId != null)
      if (!ftAssignee2?.assigneeId) { setAssignError("Task has no active assignee — it may not have been accepted yet"); return }
      if (selectedMemberId === ftAssignee2.userId) { setAssignError("Cannot delegate to the current assignee"); return }
      const taskAssigneeId = ftAssignee2.assigneeId

      await productivityCall(environment, accessToken, "tasks.delegate", {
        id: selectedTask.taskId,
        body: { taskAssigneeId, newUserId: selectedMemberId },
      })
      setSelectedTask(null)
      fetchTasksForProjects([...checkedProjects])
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      if (msg.includes("409") || msg.includes("conflicting")) {
        setAssignError("Cannot delegate to this user — they may already be assigned or cannot receive delegations")
      } else {
        setAssignError(msg || "Failed to delegate")
      }
    } finally {
      setAssigning(false)
    }
  }

  const isAnyLoading = loadingActivities || loadingProjects || loadingTasks

  if (!isConnected) return null

  const TYPE_LABELS: Record<EnrichedTask["assigneeType"], string> = { user: "Users", role: "Roles", team: "Groups", unassigned: "Unassigned" }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {!hideHeader && <Navbar />}
      <main className="flex-1 flex flex-col px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Team Capacity</h1>
            <p className="text-sm text-muted-foreground mt-1">All tasks by week and assignee</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border overflow-hidden text-xs font-medium">
              <button
                onClick={() => setViewMode("week")}
                className={`px-3 py-1.5 transition-colors ${viewMode === "week" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted/50"}`}
              >
                Week
              </button>
              <button
                onClick={() => setViewMode("day")}
                className={`px-3 py-1.5 transition-colors border-l border-border ${viewMode === "day" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted/50"}`}
              >
                Day
              </button>
            </div>
            <Button variant="outline" size="sm" onClick={() => fetchTasksForProjects([...checkedProjects])} disabled={isAnyLoading}>
              {isAnyLoading
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                : <RefreshCw className="h-4 w-4 mr-1" />}
              Refresh
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-5">

          {/* Date Range */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted/50 transition-colors">
                {rangeStart && rangeEnd ? `${rangeStart} – ${rangeEnd}` : "Date range"}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-3">
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">From</label>
                  <input
                    type="date"
                    value={rangeStart}
                    onChange={e => setRangeStart(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">To</label>
                  <input
                    type="date"
                    value={rangeEnd}
                    onChange={e => setRangeEnd(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Activities */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted/50 transition-colors">
                {loadingActivities && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                Activities
                {!loadingActivities && filteredActivities.length > 0 && (
                  <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
                    {checkedActivities.size} / {filteredActivities.length}
                  </Badge>
                )}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 p-3">
              {activitiesError && (
                <div className="mb-2 flex items-center gap-2 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {activitiesError}
                </div>
              )}
              {!loadingActivities && filteredActivities.length === 0 && !activitiesError && (
                <p className="text-xs text-muted-foreground">{activities.length === 0 ? "No activities found." : "No activities in selected date range."}</p>
              )}
              {filteredActivities.length > 0 && (() => {
                const allChecked = filteredActivities.every(a => checkedActivities.has(a.activityId))
                const someChecked = filteredActivities.some(a => checkedActivities.has(a.activityId))
                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2.5 border-b border-border pb-1">
                      <Checkbox
                        id="activity-select-all"
                        checked={allChecked}
                        data-state={someChecked && !allChecked ? "indeterminate" : undefined}
                        onCheckedChange={() =>
                          setCheckedActivities(allChecked
                            ? new Set()
                            : new Set(filteredActivities.map(a => a.activityId))
                          )
                        }
                        className="shrink-0"
                      />
                      <label htmlFor="activity-select-all" className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
                        Select all ({filteredActivities.length}{filteredActivities.length !== activities.length ? ` of ${activities.length}` : ""})
                      </label>
                    </div>
                    <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                      {filteredActivities.map(a => {
                        const checked = checkedActivities.has(a.activityId)
                        return (
                          <li key={a.activityId} className="flex items-start gap-2.5">
                            <Checkbox
                              id={`activity-${a.activityId}`}
                              checked={checked}
                              onCheckedChange={() =>
                                setCheckedActivities(prev => {
                                  const next = new Set(prev)
                                  next.has(a.activityId) ? next.delete(a.activityId) : next.add(a.activityId)
                                  return next
                                })
                              }
                              className="mt-0.5 shrink-0"
                            />
                            <label
                              htmlFor={`activity-${a.activityId}`}
                              className="cursor-pointer select-none text-xs leading-snug text-foreground"
                            >
                              {a.name ?? `Activity ${a.activityId}`}
                              <span className="font-normal text-muted-foreground"> ({a.activityId})</span>
                              {a.activityStateName && (
                                <Badge variant="outline" className="ml-1.5 px-1 py-0 text-[10px] font-normal">
                                  {a.activityStateName}
                                </Badge>
                              )}
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )
              })()}
            </PopoverContent>
          </Popover>

          {/* Projects — only shown when activities have been loaded/selected */}
          {(checkedActivities.size > 0 || projects.length > 0 || loadingProjects) && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted/50 transition-colors">
                  {loadingProjects && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                  Projects
                  {!loadingProjects && projects.length > 0 && (() => {
                    const visible = enabledProjectStatuses.size < projectStatusList.length
                      ? projects.filter(p => p.projectStatus === undefined || enabledProjectStatuses.has(p.projectStatus)).length
                      : projects.length
                    return (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
                        {checkedProjects.size} / {visible}
                      </Badge>
                    )
                  })()}
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-3">
                <div className="space-y-3">
                  {projectsError && (
                    <div className="flex items-center gap-2 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {projectsError}
                    </div>
                  )}
                  {projectStatusList.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="shrink-0 text-xs text-muted-foreground">Status:</span>
                      {projectStatusList.map(s => {
                        const isOn = enabledProjectStatuses.has(s)
                        const label = projectStatusNameMap.get(s) ?? String(s)
                        return (
                          <button
                            key={s}
                            onClick={() =>
                              setEnabledProjectStatuses(prev => {
                                const next = new Set(prev)
                                next.has(s) ? next.delete(s) : next.add(s)
                                return next
                              })
                            }
                            className={`inline-flex cursor-pointer select-none items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                              isOn
                                ? "border-primary/30 bg-primary/10 font-medium text-primary"
                                : "border-border bg-background text-muted-foreground opacity-50"
                            }`}
                          >
                            {!isOn && <X className="h-3 w-3" />}
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {!loadingProjects && projects.length === 0 && !projectsError && (
                    <p className="text-xs text-muted-foreground">No projects found for the selected activities.</p>
                  )}
                  {projects.length > 0 && (() => {
                    const visible = projects.filter(p =>
                      p.projectStatus === undefined || enabledProjectStatuses.has(p.projectStatus)
                    )
                    if (visible.length === 0) return null
                    const allChecked = visible.every(p => checkedProjects.has(p.projectId))
                    const someChecked = visible.some(p => checkedProjects.has(p.projectId))
                    return (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2.5 border-b border-border pb-1">
                          <Checkbox
                            id="project-select-all"
                            checked={allChecked}
                            data-state={someChecked && !allChecked ? "indeterminate" : undefined}
                            onCheckedChange={() =>
                              setCheckedProjects(allChecked
                                ? new Set()
                                : new Set(visible.map(p => p.projectId))
                              )
                            }
                            className="shrink-0"
                          />
                          <label htmlFor="project-select-all" className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
                            Select all ({visible.length})
                          </label>
                        </div>
                        <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                          {visible.map(p => {
                            const checked = checkedProjects.has(p.projectId)
                            return (
                              <li key={p.projectId} className="flex items-start gap-2.5">
                                <Checkbox
                                  id={`project-${p.projectId}`}
                                  checked={checked}
                                  onCheckedChange={() =>
                                    setCheckedProjects(prev => {
                                      const next = new Set(prev)
                                      next.has(p.projectId) ? next.delete(p.projectId) : next.add(p.projectId)
                                      return next
                                    })
                                  }
                                  className="mt-0.5 shrink-0"
                                />
                                <label
                                  htmlFor={`project-${p.projectId}`}
                                  className="cursor-pointer select-none text-xs leading-snug text-foreground"
                                >
                                  {p.title ?? `Project ${p.projectId}`}
                                  <span className="font-normal text-muted-foreground"> ({p.projectId})</span>
                                  {p.projectStatus !== undefined && projectStatusNameMap.get(p.projectStatus) && (
                                    <Badge variant="outline" className="ml-1.5 px-1 py-0 text-[10px] font-normal">
                                      {projectStatusNameMap.get(p.projectStatus)}
                                    </Badge>
                                  )}
                                </label>
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                    )
                  })()}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Task status dropdown */}
          {statusList.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-muted/50 transition-colors">
                  Task Status
                  <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
                    {enabledStatuses.size} / {statusList.length}
                  </Badge>
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-3">
                <div className="flex flex-wrap gap-1.5">
                  {statusList.map(s => {
                    const isOn = enabledStatuses.has(s)
                    const label = statusNameMap.get(s) ?? String(s)
                    return (
                      <button
                        key={s}
                        onClick={() => toggleStatus(s)}
                        className={`inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full border transition-colors cursor-pointer select-none ${
                          isOn
                            ? "bg-primary/10 border-primary/30 text-primary font-medium"
                            : "bg-background border-border text-muted-foreground opacity-50"
                        }`}
                      >
                        {!isOn && <X className="h-3 w-3" />}
                        {label}
                      </button>
                    )
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}

          {/* Assignee label + pills */}
          {assigneeRows.length > 0 && (
            <span className="text-xs text-muted-foreground shrink-0">Assignee:</span>
          )}

          {/* Assignee pills */}
          {assigneeRows.map(({ name, type }) => {
            const isOn = checkedAssignees.has(name)
            const c = assigneeColor(type)
            const isHex = c.startsWith("#")
            return (
              <button
                key={name}
                onClick={() =>
                  setCheckedAssignees(prev => {
                    const next = new Set(prev)
                    next.has(name) ? next.delete(name) : next.add(name)
                    return next
                  })
                }
                className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full border transition-colors cursor-pointer select-none font-medium"
                style={isOn
                  ? { backgroundColor: isHex ? c + "1A" : "color-mix(in oklch, var(--primary) 10%, transparent)", borderColor: isHex ? c + "66" : "color-mix(in oklch, var(--primary) 30%, transparent)", color: c }
                  : { backgroundColor: "transparent", borderColor: isHex ? c + "33" : "color-mix(in oklch, var(--primary) 30%, transparent)", color: c, opacity: 0.5 }
                }
              >
                {!isOn && <X className="h-3 w-3" />}
                {name}
                {type === "role" && <span className="opacity-60 font-normal">· Role</span>}
                {type === "team" && <span className="opacity-60 font-normal">· Group</span>}
              </button>
            )
          })}

        </div>{/* end filter bar */}

        {/* Tasks error */}
        {tasksError && (
          <div className="flex items-center gap-2 text-destructive text-xs mb-3">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {tasksError}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-destructive bg-destructive/10 rounded-md px-4 py-3 mb-6">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}


        {/* Grid */}
        {!error && (
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-base min-w-max">
              <thead>
                {viewMode === "day" && (() => {
                  // Group consecutive days by ISO week
                  const weekGroups: Array<{ weekKey: string; label: string; count: number; containsToday: boolean }> = []
                  for (const d of days) {
                    const wk = getISOWeekKey(d.date)
                    const last = weekGroups[weekGroups.length - 1]
                    if (last && last.weekKey === wk) {
                      last.count++
                      if (d.key === currentDayKey) last.containsToday = true
                    } else {
                      weekGroups.push({ weekKey: wk, label: formatWeekLabel(getWeekStart(d.date)), count: 1, containsToday: d.key === currentDayKey })
                    }
                  }
                  return (
                    <tr className="bg-muted/50">
                      <th className="sticky left-0 z-20 bg-muted/50 border border-border px-3 py-2.5 text-left font-semibold min-w-[220px] whitespace-nowrap" rowSpan={2}>
                        Assignee
                      </th>
                      {weekGroups.map(g => (
                        <th
                          key={g.weekKey}
                          colSpan={g.count}
                          className={`border border-border px-3 py-1.5 text-center text-xs font-semibold text-muted-foreground whitespace-nowrap ${g.containsToday ? "bg-primary/10" : ""}`}
                        >
                          {g.label}
                          {g.weekKey === currentWeekKey && (
                            <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 px-1">this week</Badge>
                          )}
                        </th>
                      ))}
                      <th className="border border-border px-3 py-2.5 text-center font-medium min-w-[120px] text-muted-foreground" rowSpan={2}>
                        Unscheduled
                      </th>
                    </tr>
                  )
                })()}
                <tr className="bg-muted/50">
                  {viewMode === "day" || (
                    <th className="sticky left-0 z-20 bg-muted/50 border border-border px-3 py-2.5 text-left font-semibold min-w-[220px] whitespace-nowrap">
                      Assignee
                    </th>
                  )}
                  {viewMode === "week"
                    ? weeks.map(w => (
                        <th
                          key={w.key}
                          className={`border border-border px-3 py-2.5 text-center font-medium min-w-[150px] whitespace-nowrap ${
                            w.key === currentWeekKey ? "bg-primary/10" : ""
                          }`}
                        >
                          {w.label}
                          {w.key === currentWeekKey && (
                            <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 px-1">now</Badge>
                          )}
                        </th>
                      ))
                    : days.map(d => (
                        <th
                          key={d.key}
                          className={`border border-border px-3 py-2.5 text-center font-medium min-w-[120px] whitespace-nowrap ${
                            d.key === currentDayKey ? "bg-primary/10" : ""
                          }`}
                        >
                          {d.label}
                          {d.key === currentDayKey && (
                            <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 px-1">today</Badge>
                          )}
                        </th>
                      ))
                  }
                  {viewMode === "week" && (
                    <th className="border border-border px-3 py-2.5 text-center font-medium min-w-[120px] text-muted-foreground">
                      Unscheduled
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const visibleRows = assigneeRows.filter(({ name }) => checkedAssignees.size === 0 || checkedAssignees.has(name))
                  return visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={(viewMode === "day" ? days.length : weeks.length) + 2} className="text-center py-16 text-muted-foreground">
                      No tasks found
                    </td>
                  </tr>
                ) : (
                  visibleRows.flatMap(({ name: assignee, type: assigneeType }, idx) => [
                    assigneeType !== visibleRows[idx - 1]?.type ? (
                      <tr key={`heading-${assigneeType}`}>
                        <td colSpan={(viewMode === "day" ? days.length : weeks.length) + 2} className="border border-border bg-muted/50 px-3 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                          {TYPE_LABELS[assigneeType]}
                        </td>
                      </tr>
                    ) : null,
                    <tr key={assignee} className="hover:bg-muted/20 transition-colors">
                      <td className="sticky left-0 z-10 bg-background border border-border px-3 py-2 font-medium whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span style={{ color: assigneeColor(assigneeType) }}>{assignee}</span>
                          {(assigneeType === "role" || assigneeType === "team") && (() => {
                            const c = assigneeColor(assigneeType)
                            return <span className="text-[10px] font-normal rounded px-1" style={{ color: c, border: `1px solid ${c}` }}>{assigneeType === "role" ? "Role" : "Group"}</span>
                          })()}
                        </div>
                      </td>

                      {(viewMode === "day" ? days : weeks).map(col => {
                        const colKey = col.key
                        const isCurrentCol = viewMode === "day" ? colKey === currentDayKey : colKey === currentWeekKey
                        const cellKey = `${assignee}::${colKey}`
                        const cellTasks = getCellTasks(assignee, colKey)
                        const expanded = expandedCells.has(cellKey)
                        return (
                          <td
                            key={colKey}
                            className="border border-border px-2 py-2 align-top"
                            style={(() => {
                              const c = assigneeColor(assigneeType)
                              const isHex = c.startsWith("#")
                              return { backgroundColor: isHex ? (isCurrentCol ? c + "22" : c + "0D") : (isCurrentCol ? "color-mix(in oklch, var(--primary) 8%, transparent)" : "color-mix(in oklch, var(--primary) 4%, transparent)") }
                            })()}
                          >
                            {cellTasks.length > 0 && (() => {
                              const totalMins = cellTasks.reduce((s, t) => s + (t.estimatedWork ?? 0), 0)
                              return (
                                <div>
                                  <button
                                    onClick={() => toggleCell(cellKey)}
                                    className="flex items-center gap-1 text-sm font-medium hover:underline mb-1 cursor-pointer"
                                    style={{ color: assigneeColor(assigneeType) }}
                                  >
                                    <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} />
                                    {cellTasks.length} task{cellTasks.length !== 1 ? "s" : ""}
                                    {totalMins > 0 && (
                                      <span className="text-muted-foreground font-normal">· {fmtMinutes(totalMins)}</span>
                                    )}
                                  </button>
                                  {expanded && (
                                    <ul className="space-y-1.5 mt-1">
                                      {cellTasks.map(t => (
                                        <li key={t.taskId}>
                                          <button
                                            onClick={() => setSelectedTask(t)}
                                            className="text-sm leading-snug text-left w-full text-foreground hover:underline"
                                          >
                                            <span>
                                              {t.name ?? `Task ${t.taskId}`}
                                              {t.projectId != null && (
                                                <span className="text-muted-foreground font-normal"> ({projects.find(p => p.projectId === t.projectId)?.title ?? `Project ${t.projectId}`})</span>
                                              )}
                                            </span>
                                            {t.isReviewTask && (
                                              <Badge variant="outline" className="ml-1 text-[10px] py-0 px-1 font-normal text-blue-600 border-blue-300">
                                                Review
                                              </Badge>
                                            )}
                                            {t.workFlowTaskStatus !== undefined && (
                                              <Badge variant="outline" className="ml-1 text-[10px] py-0 px-1 font-normal">
                                                {statusNameMap.get(t.workFlowTaskStatus) ?? t.workFlowTaskStatus}
                                              </Badge>
                                            )}
                                            {t.estimatedWork != null && t.estimatedWork > 0 && (
                                              <span className="ml-1 text-[10px] text-muted-foreground">
                                                {fmtMinutes(t.estimatedWork)}
                                              </span>
                                            )}
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )
                            })()}
                          </td>
                        )
                      })}

                      {/* Unscheduled */}
                      {(() => {
                        const cellKey = `${assignee}::unscheduled`
                        const cellTasks = getUnscheduled(assignee)
                        const expanded = expandedCells.has(cellKey)
                        return (
                          <td
                            className="border border-border px-2 py-2 align-top"
                            style={(() => {
                              const c = assigneeColor(assigneeType)
                              return { backgroundColor: c.startsWith("#") ? c + "0D" : "color-mix(in oklch, var(--primary) 4%, transparent)" }
                            })()}
                          >
                            {cellTasks.length > 0 && (() => {
                              const totalMins = cellTasks.reduce((s, t) => s + (t.estimatedWork ?? 0), 0)
                              return (
                                <div>
                                  <button
                                    onClick={() => toggleCell(cellKey)}
                                    className="flex items-center gap-1 text-sm font-medium hover:underline mb-1 cursor-pointer"
                                    style={{ color: assigneeColor(assigneeType) }}
                                  >
                                    <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "" : "-rotate-90"}`} />
                                    {cellTasks.length}
                                    {totalMins > 0 && (
                                      <span className="font-normal">· {fmtMinutes(totalMins)}</span>
                                    )}
                                  </button>
                                  {expanded && (
                                    <ul className="space-y-1.5 mt-1">
                                      {cellTasks.map(t => (
                                        <li key={t.taskId}>
                                          <button
                                            onClick={() => setSelectedTask(t)}
                                            className="text-sm leading-snug text-left w-full text-foreground hover:underline"
                                          >
                                            {t.name ?? `Task ${t.taskId}`}
                                            {t.projectId != null && (
                                              <span className="text-muted-foreground font-normal"> ({projects.find(p => p.projectId === t.projectId)?.title ?? `Project ${t.projectId}`})</span>
                                            )}
                                            {t.estimatedWork != null && t.estimatedWork > 0 && (
                                              <span className="ml-1 text-[10px]">
                                                {fmtMinutes(t.estimatedWork)}
                                              </span>
                                            )}
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )
                            })()}
                          </td>
                        )
                      })()}
                    </tr>,
                  ])
                )})()}
                {/* Totals row */}
                {assigneeRows.length > 0 && (
                  <tr className="bg-muted/30 font-semibold text-xs border-t-2 border-border">
                    <td className="sticky left-0 z-10 bg-muted/30 border border-border px-3 py-2 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="w-4 shrink-0" />
                        Totals
                        {checkedAssignees.size < assigneeRows.length && (
                          <span className="font-normal text-[10px]">({checkedAssignees.size} of {assigneeRows.length})</span>
                        )}
                      </div>
                    </td>
                    {viewMode === "week"
                      ? weeks.map(w => {
                          const total = weekTotals.get(w.key) ?? 0
                          return (
                            <td key={w.key} className={`border border-border px-2 py-2 text-center text-muted-foreground ${w.key === currentWeekKey ? "bg-primary/5" : ""}`}>
                              {total > 0 ? fmtMinutes(total) : <span className="text-border">—</span>}
                            </td>
                          )
                        })
                      : days.map(d => {
                          const total = dayTotals.get(d.key) ?? 0
                          return (
                            <td key={d.key} className={`border border-border px-2 py-2 text-center text-muted-foreground ${d.key === currentDayKey ? "bg-primary/5" : ""}`}>
                              {total > 0 ? fmtMinutes(total) : <span className="text-border">—</span>}
                            </td>
                          )
                        })
                    }
                    <td className="border border-border px-2 py-2 text-center text-muted-foreground">
                      {(viewMode === "day" ? unscheduledDayTotal : unscheduledTotal) > 0
                        ? fmtMinutes(viewMode === "day" ? unscheduledDayTotal : unscheduledTotal)
                        : <span className="text-border">—</span>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

          </div>
        )}
      </main>
      {!hideHeader && <Footer />}

      {/* Loading overlay */}
      <div className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/60 backdrop-blur-sm transition-opacity duration-300 ${isAnyLoading ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">
          {loadingActivities ? "Loading activities…" : loadingProjects ? "Loading projects…" : "Loading tasks…"}
        </span>
      </div>

      {/* Task detail modal */}
      <Dialog open={selectedTask !== null} onOpenChange={open => { if (!open) setSelectedTask(null) }}>
        <DialogContent className="max-w-md overflow-hidden p-0" aria-describedby={undefined}>
          {selectedTask && (() => {
            const project = projects.find(p => p.projectId === selectedTask.projectId)
            const activityId = selectedTask.projectId != null ? projectToActivityId.get(selectedTask.projectId) : undefined
            const activity = activityId != null ? activities.find(a => a.activityId === activityId) : undefined
            return (
              <div className="flex flex-col max-h-[80vh]">
              <div className="px-6 pt-6 pb-3 shrink-0 border-b border-border">
                <DialogHeader>
                  <DialogTitle className="text-base leading-snug">
                    {selectedTask.name ?? `Task ${selectedTask.taskId}`}
                    {selectedTask.taskId && <span className="text-muted-foreground font-normal text-sm ml-1">({selectedTask.taskId})</span>}
                  </DialogTitle>
                </DialogHeader>
                {(() => {
                  const base = `https://${connection?.environment}.aprimo.com/MarketingOps/#`
                  return (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {selectedTask.projectId != null && (
                        <a
                          href={`${base}/project-overview?projectId=${selectedTask.projectId}&isUseAction=true&SPAContainer=true`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
                          style={{ color: "#00B2A9", borderColor: "#00B2A966", backgroundColor: "#00B2A91A" }}
                          onClick={() => setSelectedTask(null)}
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open Project
                        </a>
                      )}
                    </div>
                  )
                })()}
              </div>
              <div className="overflow-y-auto px-6 py-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm mt-1">
                <dt className="text-muted-foreground font-medium">Activity</dt>
                <dd>
                  {activity?.name ?? (activityId != null ? `Activity ${activityId}` : "—")}
                  {activityId != null && <span className="text-muted-foreground text-xs ml-1">({activityId})</span>}
                </dd>

                <dt className="text-muted-foreground font-medium">Project</dt>
                <dd>
                  {project?.title ?? (selectedTask.projectId != null ? `Project ${selectedTask.projectId}` : "—")}
                  {selectedTask.projectId != null && <span className="text-muted-foreground text-xs ml-1">({selectedTask.projectId})</span>}
                </dd>

                {selectedTask.workFlowTaskStatus !== undefined && (
                  <>
                    <dt className="text-muted-foreground font-medium">Status</dt>
                    <dd>
                      <Badge variant="outline" className="text-xs font-normal">
                        {statusNameMap.get(selectedTask.workFlowTaskStatus) ?? selectedTask.workFlowTaskStatus}
                      </Badge>
                    </dd>
                  </>
                )}

                {selectedTask.estimatedWork != null && selectedTask.estimatedWork > 0 && (
                  <>
                    <dt className="text-muted-foreground font-medium">Estimated work</dt>
                    <dd>{fmtMinutes(selectedTask.estimatedWork)}</dd>
                  </>
                )}

                {selectedTask.beginDate && (
                  <>
                    <dt className="text-muted-foreground font-medium">Start</dt>
                    <dd>{new Date(selectedTask.beginDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd>
                  </>
                )}

                {selectedTask.endDate && (
                  <>
                    <dt className="text-muted-foreground font-medium">Due</dt>
                    <dd>{new Date(selectedTask.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</dd>
                  </>
                )}

                <dt className="text-muted-foreground font-medium">Assignee</dt>
                <dd>{selectedTask.assigneeName}</dd>

                {selectedTask.assigneeType === "user" && (
                  <>
                    <dt className="text-muted-foreground font-medium pt-1 self-start">Delegate to</dt>
                    <dd className="space-y-2">
                      {modalTaskDetail && !modalTaskDetail?._links?.delegate ? (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          This task cannot be delegated in its current state
                        </p>
                      ) : modalTaskDetail && !modalTaskDetail?.assignees?.find((a: { assigneeId?: number }) => a.assigneeId != null) ? (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          Task has no active assignee — it may not have been accepted yet
                        </p>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              placeholder="Search by last name…"
                              value={userSearchQuery}
                              onChange={e => handleUserSearchInput(e.target.value)}
                              className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                            />
                            {userSearchLoading && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-muted-foreground" />}
                          </div>
                          {userSearchError && (
                            <p className="flex items-center gap-1 text-xs text-destructive">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              {userSearchError}
                            </p>
                          )}
                          {userSearchResults.length > 0 && (
                            <div className="space-y-2">
                              <table className="w-full border-collapse text-sm">
                                <thead>
                                  <tr className="border-b border-border">
                                    <th className="w-7 pb-1" />
                                    <th className="pb-1 pr-4 text-left text-xs font-semibold text-muted-foreground">First</th>
                                    <th className="pb-1 text-left text-xs font-semibold text-muted-foreground">Last</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {userSearchResults.map(u => (
                                    <tr
                                      key={u.userId}
                                      className="cursor-pointer border-b border-border/40 hover:bg-muted/30 transition-colors"
                                      onClick={() => setSelectedMemberId(u.userId)}
                                    >
                                      <td className="py-1.5 pr-2">
                                        <input
                                          type="radio"
                                          name="reassign-user"
                                          checked={selectedMemberId === u.userId}
                                          onChange={() => setSelectedMemberId(u.userId)}
                                          className="cursor-pointer accent-primary"
                                        />
                                      </td>
                                      <td className="py-1.5 pr-4">{u.firstName}</td>
                                      <td className="py-1.5">{u.lastName}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {assignError && (
                                <p className="flex items-center gap-1 text-xs text-destructive">
                                  <AlertCircle className="h-3 w-3 shrink-0" />
                                  {assignError}
                                </p>
                              )}
                              <Button
                                size="sm"
                                disabled={selectedMemberId === null || assigning}
                                onClick={assignUser}
                              >
                                {assigning && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                                Delegate
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </dd>
                  </>
                )}

                {(selectedTask.assigneeType === "team" || selectedTask.assigneeType === "role") && (
                  <>
                    {selectedTask.assigneeType === "role" && (() => {
                      const assignedUserId = selectedTask.taskRoles?.find(r => r.userId != null)?.userId
                        ?? selectedTask.assignees?.find(a => a.userId != null)?.userId
                      const assignedName = assignedUserId != null
                        ? (userNameMap.get(assignedUserId) ?? `User ${assignedUserId}`)
                        : null
                      return (
                        <>
                          {assignedName && (
                            <>
                              <dt className="text-muted-foreground font-medium">Task assigned to</dt>
                              <dd>{assignedName}</dd>
                            </>
                          )}
                          {modalProjectRoleUser && (
                            <>
                              <dt className="text-muted-foreground font-medium">Project role assigned to</dt>
                              <dd>{modalProjectRoleUser}</dd>
                            </>
                          )}
                          {modalActivityRoleUser && (
                            <>
                              <dt className="text-muted-foreground font-medium">Activity role assigned to</dt>
                              <dd>{modalActivityRoleUser}</dd>
                            </>
                          )}
                        </>
                      )
                    })()}
                    <dt className="text-muted-foreground font-medium pt-1 self-start">Members</dt>
                    <dd className="space-y-2">
                      {modalMembers.loading && (
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading…
                        </span>
                      )}
                      {modalMembers.error && (
                        <span className="flex items-center gap-1 text-xs text-destructive">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          {modalMembers.error}
                        </span>
                      )}
                      {!modalMembers.loading && !modalMembers.error && modalMembers.users.length === 0 && (
                        <span className="text-sm text-muted-foreground">None</span>
                      )}
                      {modalMembers.users.length > 0 && (
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="pb-1 pr-4 text-left text-xs font-semibold text-muted-foreground">First</th>
                              <th className="pb-1 text-left text-xs font-semibold text-muted-foreground">Last</th>
                            </tr>
                          </thead>
                          <tbody>
                            {modalMembers.users.map(u => (
                              <tr key={u.userId} className="border-b border-border/40">
                                <td className="py-1.5 pr-4">{u.firstName}</td>
                                <td className="py-1.5">{u.lastName}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </dd>
                  </>
                )}
              </dl>
              </div>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
