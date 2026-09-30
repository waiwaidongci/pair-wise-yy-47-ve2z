import axios from 'axios'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Issue, OfflinePage, OfflineSubmission } from '../api/types'
import { seedIssues } from '../api/seed'
import { applySubmission, decideRetest } from '../api/merge'

type SavedFilter = { id: string; name: string; query: string; site: string; status: string; priority: string }

export type SyncStatus = 'idle' | 'syncing' | 'interrupted' | 'done'

/** 每个断网页的并入进度（断点 = 最后确认项索引，恢复时从下一项继续） */
export type PageProgress = {
  pageId: string
  applied: number
  duplicates: number
  status: SyncStatus
  error?: string
}

type WorkspaceState = {
  issues: Issue[]
  selectedKeys: string[]
  savedFilters: SavedFilter[]
  draft: string
  mergeKeys: string[]
  /** 存在已落地但尚未全部同步成功的断网改动时，停止用 GET 结果覆盖本地 */
  offlineDirty: boolean
  progress: Record<string, PageProgress>
  setIssues: (issues: Issue[]) => void
  setSelectedKeys: (keys: string[]) => void
  saveFilter: (filter: Omit<SavedFilter, 'id'>) => void
  removeFilter: (id: string) => void
  setDraft: (draft: string) => void
  mergeIssues: (keys: string[]) => void
  updateIssue: (issue: Issue) => void
  syncPage: (page: OfflinePage) => Promise<void>
  resumePage: (page: OfflinePage) => Promise<void>
  decideRecord: (issueKey: string, recordId: string, decision: '已采纳' | '已驳回') => Promise<void>
  resetSync: () => Promise<void>
  patchProgress: (pageId: string, patch: Partial<PageProgress>) => void
}

const ensureShape = (issues: Issue[]): Issue[] =>
  issues.map((issue) => ({
    ...issue,
    invalidations: issue.invalidations ?? [],
    retestRecords: (issue.retestRecords ?? []).map((record) =>
      record.confirmation ? record : { ...record, confirmation: '已采纳' as const },
    ),
  }))

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => {
      /** 逐条并入并与服务端核对；在第一个失败项中断，保留已确认项改动 */
      const runPage = async (page: OfflinePage, startIndex: number) => {
        set((state) => ({
          offlineDirty: true,
          progress: {
            ...state.progress,
            [page.pageId]: { pageId: page.pageId, applied: startIndex, duplicates: state.progress[page.pageId]?.duplicates ?? 0, status: 'syncing' },
          },
        }))

        let interrupted = false
        for (let index = startIndex; index < page.submissions.length; index += 1) {
          const sub = page.submissions[index]
          try {
            const { data } = await axios.post('/api/sync/submit', sub)
            if (data.duplicate) {
              // 重复提交只认第一次：本地也不重复落地
              set((state) => ({
                progress: {
                  ...state.progress,
                  [page.pageId]: { ...state.progress[page.pageId], applied: index + 1, duplicates: state.progress[page.pageId].duplicates + 1 },
                },
              }))
              continue
            }
            // 乐观落地本地改动（即使随后断连也已保留在本地）
            set((state) => {
              const { issues } = applySubmission(state.issues, sub)
              return {
                issues,
                progress: {
                  ...state.progress,
                  [page.pageId]: { ...state.progress[page.pageId], applied: index + 1 },
                },
              }
            })
          } catch (error) {
            // 导入中断：改动保留，断点停在当前最后确认项 index，恢复时从该项重试
            set((state) => ({
              progress: {
                ...state.progress,
                [page.pageId]: {
                  ...state.progress[page.pageId],
                  status: 'interrupted',
                  error: axios.isAxiosError(error) ? error.response?.data?.error ?? error.message : '网络中断',
                },
              },
            }))
            interrupted = true
            break
          }
        }

        if (!interrupted) {
          set((state) => ({ progress: { ...state.progress, [page.pageId]: { ...state.progress[page.pageId], status: 'done', error: undefined } } }))
          const allDone = Object.values(get().progress).every((item) => item.status === 'done')
          if (allDone) set({ offlineDirty: false })
        }
      }

      return {
        issues: ensureShape(structuredClone(seedIssues)),
        selectedKeys: [],
        savedFilters: [
          { id: 'f1', name: 'P0/P1 未关闭', query: '', site: '', status: '', priority: 'P0' },
          { id: 'f2', name: '基础组件组待复测', query: '基础组件', site: '', status: '待复测', priority: '' },
        ],
        draft: 'A11Y-1048：需同时验证 Esc 关闭与 Tab/Shift+Tab 环绕顺序，移动端抽屉也需复测。',
        mergeKeys: [],
        offlineDirty: false,
        progress: {},
        setIssues: (issues) => set({ issues: ensureShape(issues) }),
        setSelectedKeys: (selectedKeys) => set({ selectedKeys }),
        saveFilter: (filter) => set((state) => ({ savedFilters: [...state.savedFilters, { ...filter, id: crypto.randomUUID() }] })),
        removeFilter: (id) => set((state) => ({ savedFilters: state.savedFilters.filter((item) => item.id !== id) })),
        setDraft: (draft) => set({ draft }),
        mergeIssues: (keys) =>
          set((state) => {
            const primary = state.issues.find((issue) => issue.key === keys[0])
            if (!primary) return state
            return {
              issues: state.issues.map((issue) =>
                keys.includes(issue.key)
                  ? {
                      ...issue,
                      rootCause: primary.rootCause,
                      status: issue.key === primary.key ? issue.status : '不适用',
                      mergedKeys: issue.key === primary.key ? keys.slice(1) : [primary.key],
                      history: [...issue.history, { at: '刚刚', actor: '当前用户', action: '重复问题合并', detail: `合并至 ${primary.key}` }],
                    }
                  : issue,
              ),
              selectedKeys: [],
            }
          }),
        updateIssue: (updated) => set((state) => ({ issues: state.issues.map((issue) => (issue.key === updated.key ? ensureShape([updated])[0] : issue)) })),
        syncPage: (page) => runPage(page, 0),
        resumePage: (page) => {
          const checkpoint = get().progress[page.pageId]?.applied ?? 0
          return runPage(page, checkpoint)
        },
        decideRecord: async (issueKey, recordId, decision) => {
          const { data } = await axios.post<Issue>('/api/retest/decide', { issueKey, recordId, decision })
          set((state) => ({ issues: decideRetest(state.issues, issueKey, recordId, decision).map((item) => (item.key === issueKey ? ensureShape([data])[0] : item)) }))
        },
        resetSync: async () => {
          await axios.post('/api/sync/reset')
          set({
            issues: ensureShape(structuredClone(seedIssues)),
            progress: {},
            offlineDirty: false,
            draft: 'A11Y-1048：需同时验证 Esc 关闭与 Tab/Shift+Tab 环绕顺序，移动端抽屉也需复测。',
          })
        },
        patchProgress: (pageId, patch) =>
          set((state) => ({ progress: { ...state.progress, [pageId]: { ...state.progress[pageId], ...patch } } })),
      }
    },
    {
      name: 'accessibility-remediation-v1',
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<WorkspaceState>
        if (Array.isArray(state.issues)) state.issues = ensureShape(state.issues)
        return persisted
      },
    },
  ),
)
