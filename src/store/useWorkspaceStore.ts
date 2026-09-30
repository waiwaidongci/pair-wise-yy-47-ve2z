import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'
import type { ImportBatch, Issue, OfflinePackage } from '../api/types'
import { seedIssues } from '../api/seed'
import { computeBatchId } from '../api/offlineMerge'

type SavedFilter = { id: string; name: string; query: string; site: string; status: string; priority: string }

type ImportResult =
  | { kind: 'duplicate'; batch: ImportBatch }
  | { kind: 'failed'; batch: ImportBatch }
  | { kind: 'done'; batch: ImportBatch }

type WorkspaceState = {
  issues: Issue[]
  selectedKeys: string[]
  savedFilters: SavedFilter[]
  draft: string
  mergeKeys: string[]
  importBatches: ImportBatch[]
  /** 失败批次暂存的离线页，供断网恢复后从最后确认项续跑 */
  stagedPackages: Record<string, OfflinePackage[]>
  setIssues: (issues: Issue[]) => void
  setSelectedKeys: (keys: string[]) => void
  saveFilter: (filter: Omit<SavedFilter, 'id'>) => void
  removeFilter: (id: string) => void
  setDraft: (draft: string) => void
  mergeIssues: (keys: string[]) => void
  updateIssue: (issue: Issue) => void
  importOffline: (packages: OfflinePackage[], failAfter?: number) => Promise<ImportResult>
  resumeOffline: (batchId: string) => Promise<ImportResult>
  updateEvidence: (key: string, evidence: string) => Promise<void>
  decideRetest: (key: string, recordId: string, adopt: boolean) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      issues: structuredClone(seedIssues),
      selectedKeys: [],
      savedFilters: [
        { id: 'f1', name: 'P0/P1 未关闭', query: '', site: '', status: '', priority: 'P0' },
        { id: 'f2', name: '基础组件组待复测', query: '基础组件', site: '', status: '待复测', priority: '' },
      ],
      draft: 'A11Y-1048：需同时验证 Esc 关闭与 Tab/Shift+Tab 环绕顺序，移动端抽屉也需复测。',
      mergeKeys: [],
      importBatches: [],
      stagedPackages: {},
      setIssues: (issues) => set({ issues }),
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
      updateIssue: (updated) => set((state) => ({ issues: state.issues.map((issue) => (issue.key === updated.key ? updated : issue)) })),
      importOffline: async (packages, failAfter) => {
        const batchId = computeBatchId(packages)
        const { data } = await axios.post<{ duplicate: boolean; batch: ImportBatch; issues: Issue[] }>('/api/offline/import', { packages, failAfter })
        set((state) => ({
          issues: data.issues,
          importBatches: [data.batch, ...state.importBatches.filter((batch) => batch.id !== data.batch.id)],
          stagedPackages: data.duplicate ? state.stagedPackages : { ...state.stagedPackages, [batchId]: packages },
        }))
        return data.duplicate ? { kind: 'duplicate', batch: data.batch } : data.batch.status === 'failed' ? { kind: 'failed', batch: data.batch } : { kind: 'done', batch: data.batch }
      },
      resumeOffline: async (batchId) => {
        const packages = get().stagedPackages[batchId]
        if (!packages) throw new Error('暂存的离线页已丢失，请重新选择离线页文件')
        const { data } = await axios.post<{ duplicate: boolean; batch: ImportBatch; issues: Issue[] }>('/api/offline/resume', { batchId, packages })
        set((state) => ({
          issues: data.issues,
          importBatches: state.importBatches.map((batch) => (batch.id === batchId ? data.batch : batch)),
        }))
        return data.duplicate ? { kind: 'duplicate', batch: data.batch } : { kind: 'done', batch: data.batch }
      },
      updateEvidence: async (key, evidence) => {
        const { data } = await axios.post<Issue>(`/api/issues/${key}/evidence`, { evidence })
        get().updateIssue(data)
      },
      decideRetest: async (key, recordId, adopt) => {
        const { data } = await axios.post<Issue>(`/api/issues/${key}/retest/confirm`, { recordId, adopt })
        get().updateIssue(data)
      },
    }),
    {
      name: 'accessibility-remediation-v2',
      version: 2,
    },
  ),
)
