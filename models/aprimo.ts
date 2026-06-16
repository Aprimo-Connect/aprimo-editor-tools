export type AprimoField = {
  fieldName: string
  dataType?: string
  localizedValues?: Array<{ languageId?: string; value?: string; values?: string[] }>
}

export type AprimoRecord = {
  id: string
  title?: string | null
  contentType?: string
  status?: string
  _embedded?: {
    fields?: { items?: AprimoField[] }
    masterfilelatestversion?: {
      _embedded?: {
        thumbnail?: { uri?: string }
        preview?: { uri?: string }
      }
    }
  }
  [key: string]: unknown
}

export type OptionItem = {
  id: string
  name: string
  label: string
  labels: Array<{ languageId: string; value: string }>
}

export type FieldDef = {
  id: string
  name: string
  label: string
  dataType: string
  isReadOnly?: boolean
  rootId?: string
  items?: OptionItem[]
  acceptMultipleOptions?: boolean
}

export type ClassificationNode = {
  id: string
  name: string
  labelPath: string
  parentId?: string
  labels?: Array<{ languageId: string; value: string }>
}

export type FieldValueContext = {
  classificationsById?: Map<string, ClassificationNode>
  optionItemsByField?: Map<string, OptionItem[]>
  selectedLanguageId?: string | null
}
