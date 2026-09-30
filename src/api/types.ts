export type IssueStatus = '待分配' | '修复中' | '待复测' | '已通过' | '已退回' | '不适用'

/** 复测结论（写入复测记录的归一化口径） */
export type RetestVerdict = '通过' | '退回' | '不适用'
/** 待确认复测记录的审核结论 */
export type RetestConfirmStatus = '待确认' | '已采纳' | '已驳回'

export type RetestRecord = {
  id: string
  actor: string
  result: RetestVerdict
  note: string
  at: string
  /** 唯一提交标识，重复提交只认第一次（幂等键） */
  submissionId?: string
  /** 断网页面来源，恢复网络后并入时保留追溯 */
  sourcePage?: string
  confirmation: RetestConfirmStatus
  /** 失效的复测结论（旧的已通过在证据更新后立即失效） */
  invalidated?: boolean
}

export type Invalidation = {
  id: string
  reason: string
  evidenceBefore: string
  evidenceAfter: string
  recordId: string
  at: string
  sourcePage?: string
  active: boolean
}

export type Issue = {
  key: string
  title: string
  site: string
  version: string
  wcag: string[]
  issueType: string
  impact: '致命' | '严重' | '中等' | '轻微'
  affected: string
  reproduction: string
  evidence: string
  rootCause: string
  status: IssueStatus
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  team: string
  owner: string
  dueDate: string
  mergedKeys: string[]
  fixNote?: string
  retestEnv?: string
  retestRecords: RetestRecord[]
  /** 证据更新后导致旧“已通过”失效的来源记录 */
  invalidations: Invalidation[]
  history: Array<{ at: string; actor: string; action: string; detail: string }>
}

/** 断网时审核员带回的单条提交 */
export type OfflineSubmission = {
  submissionId: string
  issueKey: string
  sourcePage: string
  retest?: {
    actor: string
    result: RetestVerdict
    note: string
    environment: string
    at: string
  }
  evidenceUpdate?: {
    newEvidence: string
    note: string
    at: string
  }
  /** 台账外的新问题（断网期间新建） */
  newIssue?: {
    title: string
    site: string
    version: string
    wcag: string[]
    issueType: string
    impact: Issue['impact']
    affected: string
    reproduction: string
    rootCause: string
    priority: Issue['priority']
  }
}

/** 断网时带回的一页结果 */
export type OfflinePage = {
  pageId: string
  pageLabel: string
  capturedAt: string
  submissions: OfflineSubmission[]
}

export type ApplyOutcome =
  | { type: 'duplicate'; submissionId: string; issueKey: string }
  | { type: 'new-issue'; issueKey: string }
  | { type: 'invalidated'; issueKey: string; invalidationId: string }
  | { type: 'retest'; issueKey: string; recordId: string; pending: boolean }
  | { type: 'noop'; issueKey: string }
