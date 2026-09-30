import { useEffect } from 'react'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import type { Issue } from './types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export function useIssues() {
  const setIssues = useWorkspaceStore((state) => state.setIssues)
  const offlineDirty = useWorkspaceStore((state) => state.offlineDirty)
  const query = useQuery({
    queryKey: ['issues'],
    queryFn: async () => (await axios.get<Issue[]>('/api/issues')).data,
  })

  useEffect(() => {
    // 断网并入尚有未确认/未同步改动时，保留本地改动，不用服务端快照覆盖
    if (query.data && !offlineDirty) setIssues(query.data)
  }, [query.data, offlineDirty, setIssues])

  return query
}
