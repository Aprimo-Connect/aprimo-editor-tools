import { NextRequest, NextResponse } from "next/server"
import { createClient } from "aprimo-js"

// Server-side handler for Aprimo Productivity (PM) API calls.
// The PM API at https://{env}.aprimo.com does not send CORS headers for
// browser requests, so we run the aprimo-js SDK here on the server instead.
//
// Supported calls (body.call):
//   "tasks.get"              — body.params: PmQueryParams (limit, offset, …)
//   "tasks.search"           — body.request: TaskSearchRequest, body.params?: PmQueryParams
//   "tasks.delegate"         — body.id: number, body.body: { taskAssigneeId, newUserId }
//   "users.getById"          — body.id: number
//   "systemTypes.get"        — no extra args; returns all system type names
//   "systemTypes.getByName"  — body.name: string
//   "activities.get"         — body.params?: PmQueryParams (limit, offset, …)
//   "activities.search"      — body.request: ActivitySearchRequest, body.params?: PmQueryParams
export async function POST(req: NextRequest) {
  try {
    const { environment, token, call, params, id, request, name, body } = await req.json()

    if (!environment || !token || !call) {
      return NextResponse.json({ error: "Missing environment, token, or call" }, { status: 400 })
    }

    const client = createClient({
      type: "custom",
      environment,
      tokenProvider: async () => token,
    })

    let result: unknown

    if (call === "lookupLists.getById") {
      if (id === undefined) return NextResponse.json({ error: "Missing id" }, { status: 400 })
      const res = await client.productivity.lookupLists.getById(id)
      result = res.data
    } else if (call === "tasks.get") {
      const res = await client.productivity.tasks.get(params ?? {})
      result = res.data
    } else if (call === "tasks.search") {
      const res = await client.productivity.tasks.search(request ?? {}, params ?? {})
      result = res.data
    } else if (call === "users.getById") {
      if (id === undefined) return NextResponse.json({ error: "Missing id" }, { status: 400 })
      const res = await client.productivity.users.getById(id)
      result = res.data
    } else if (call === "systemTypes.get") {
      const res = await client.productivity.systemTypes.get()
      result = res.data
    } else if (call === "systemTypes.getByName") {
      if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 })
      const res = await client.productivity.systemTypes.getByName(name)
      result = res.data
    } else if (call === "activities.get") {
      const res = await client.productivity.activities.get(params ?? {})
      result = res.data
    } else if (call === "activities.search") {
      const res = await client.productivity.activities.search(request ?? {}, params ?? {})
      result = res.data
    } else if (call === "projects.getByActivityId") {
      if (id === undefined) return NextResponse.json({ error: "Missing id" }, { status: 400 })
      const res = await client.productivity.projects.getByActivityId(id, params ?? {})
      result = res.data
    } else if (call === "tasks.getByProjectId") {
      if (id === undefined) return NextResponse.json({ error: "Missing id" }, { status: 400 })
      const res = await client.productivity.tasks.search(
        { equals: { fieldName: "projectId", fieldValue: id } },
        params ?? {}
      )
      result = res.data
    } else if (call === "userRoles.get") {
      const res = await client.productivity.userRoles.get(params ?? {})
      result = res.data
    } else if (call === "userRoles.getProjectRoleMemberships") {
      if (id === undefined) return NextResponse.json({ error: "Missing id" }, { status: 400 })
      const res = await client.productivity.userRoles.getProjectRoleMemberships(id)
      result = res.data
    } else if (call === "activities.getRoleMemberships") {
      if (id === undefined) return NextResponse.json({ error: "Missing id" }, { status: 400 })
      const res = await client.productivity.activityRoles.getByActivityId(id, params ?? {})
      result = res.data
    } else if (call === "groups.getById") {
      if (id === undefined) return NextResponse.json({ error: "Missing id" }, { status: 400 })
      const res = await client.productivity.groups.getById(id)
      result = res.data
    } else if (call === "metadata.getByName") {
      if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 })
      const res = await client.productivity.metadata.getByName(name)
      result = res.data
    } else if (call === "users.search") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (client.productivity.users as any).search(request ?? {}, params ?? {})
      result = res.data
    } else if (call === "tasks.getById") {
      if (id === undefined) return NextResponse.json({ error: "Missing id" }, { status: 400 })
      const res = await client.productivity.tasks.getById(id)
      result = res.data
    } else if (call === "review-tasks.getById") {
      if (id === undefined) return NextResponse.json({ error: "Missing id" }, { status: 400 })
      const res = await fetch(`https://${environment}.aprimo.com/api/review-tasks/${id}`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", API: "1" },
      })
      if (!res.ok) throw new Error(`PM API error ${res.status}: ${await res.text()}`)
      result = await res.json()
    } else if (call === "review-tasks.search") {
      const qs = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}` : ""
      const res = await fetch(`https://${environment}.aprimo.com/api/review-tasks/search${qs}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", API: "1" },
        body: JSON.stringify(request ?? {}),
      })
      if (!res.ok) throw new Error(`PM API error ${res.status}: ${await res.text()}`)
      result = await res.json()
    } else if (call === "tasks.delegate") {
      if (id === undefined) return NextResponse.json({ error: "Missing id" }, { status: 400 })
      const res = await client.productivity.tasks.delegate(id, body as { taskAssigneeId: number; newUserId: number })
      if (!res.ok) throw new Error(`PM API error ${res.status}: ${JSON.stringify(res.error ?? res.data)}`)
      result = res.data ?? {}
    } else {
      return NextResponse.json({ error: `Unknown call: ${call}` }, { status: 400 })
    }

    return NextResponse.json({ data: result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    )
  }
}
