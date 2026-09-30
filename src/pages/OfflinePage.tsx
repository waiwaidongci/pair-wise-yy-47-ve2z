import { useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Input, Space, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { CloudDownloadOutlined, CloudSyncOutlined, ImportOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ImportBatch, Issue, OfflinePackage, RetestRecord } from '../api/types'
import { useIssues } from '../api/useIssues'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { nowLabel, selectBlockingIssues, selectInvalidatedIssues, selectPendingEntries } from '../api/offlineMerge'

type ParsedFile = { name: string; pkg: OfflinePackage | null }

function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function parseFile(file: File): Promise<OfflinePackage> {
  const text = await file.text()
  const parsed = JSON.parse(text) as OfflinePackage
  if (parsed.format !== 'a11y-offline-page' || !Array.isArray(parsed.issues)) {
    throw new Error('不是有效的离线页文件（缺少 format 或 issues）')
  }
  return parsed
}

/** 生成两页分歧示例：同一问题 A11Y-1048 两页各有一条新复测（结论冲突），B 页另含 A11Y-1074 单条通过 */
function buildSamplePackages(base: Issue[]): OfflinePackage[] {
  const withRecord = (key: string, record: RetestRecord): Issue[] =>
    base.map((issue) => (issue.key === key ? { ...issue, retestRecords: [...issue.retestRecords, record] } : issue))
  const pageA: OfflinePackage = {
    format: 'a11y-offline-page',
    page: '离线页 A',
    exportedAt: '2026-09-30 09:30',
    exportedBy: '苏禾',
    issues: withRecord('A11Y-1048', { id: 'RT-SAMPLE-A1', actor: '苏禾', result: '通过', note: '离线复测：Esc 关闭正常，焦点返回触发按钮，移动端未逃逸。', at: '09-30 09:12', source: '离线页 A' }),
  }
  const pageB: OfflinePackage = {
    format: 'a11y-offline-page',
    page: '离线页 B',
    exportedAt: '2026-09-30 09:35',
    exportedBy: '苏禾',
    issues: withRecord('A11Y-1048', { id: 'RT-SAMPLE-B1', actor: '苏禾', result: '退回', note: '离线复测：移动端 Safari 焦点仍逃逸到地址栏，与 A 页结论冲突。', at: '09-30 09:47', source: '离线页 B' }).map((issue) =>
      issue.key === 'A11Y-1074'
        ? { ...issue, retestRecords: [...issue.retestRecords, { id: 'RT-SAMPLE-B2', actor: '苏禾', result: '通过', note: '离线复测：新色板对比度 5.4:1，纹理可切换，通过。', at: '09-30 10:05', source: '离线页 B' }] }
        : issue,
    ),
  }
  return [pageA, pageB]
}

export default function OfflinePage() {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const importBatches = useWorkspaceStore((state) => state.importBatches)
  const importOffline = useWorkspaceStore((state) => state.importOffline)
  const resumeOffline = useWorkspaceStore((state) => state.resumeOffline)
  const decideRetest = useWorkspaceStore((state) => state.decideRetest)

  const [pageName, setPageName] = useState('离线页 A')
  const [fileA, setFileA] = useState<ParsedFile>({ name: '', pkg: null })
  const [fileB, setFileB] = useState<ParsedFile>({ name: '', pkg: null })
  const [failAfter, setFailAfter] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)

  const pendingEntries = useMemo(() => selectPendingEntries(issues), [issues])
  const blockingCount = useMemo(() => selectBlockingIssues(issues).length, [issues])
  const invalidatedCount = useMemo(() => selectInvalidatedIssues(issues).length, [issues])

  const exportCurrentPage = () => {
    const pkg: OfflinePackage = { format: 'a11y-offline-page', page: pageName.trim() || '离线页', exportedAt: nowLabel(), exportedBy: '当前用户', issues }
    downloadJson(`离线页-${pkg.page}-${pkg.exportedAt.replace(/[ :]/g, '')}.json`, pkg)
    message.success(`已导出离线页「${pkg.page}」，可断网携带`)
  }

  const loadSample = () => {
    const [a, b] = buildSamplePackages(issues)
    setFileA({ name: '离线页-A-示例.json', pkg: a })
    setFileB({ name: '离线页-B-示例.json', pkg: b })
    message.info('已载入两页分歧示例：A11Y-1048 两页各有一条新复测')
  }

  const onPickFile = async (side: 'A' | 'B', file: File | undefined) => {
    if (!file) return
    try {
      const pkg = await parseFile(file)
      const parsed = { name: file.name, pkg }
      if (side === 'A') setFileA(parsed)
      else setFileB(parsed)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '离线页解析失败')
    }
  }

  const doImport = async () => {
    const packages = [fileA.pkg, fileB.pkg].filter((pkg): pkg is OfflinePackage => Boolean(pkg))
    if (packages.length === 0) {
      message.warning('请先选择至少一页离线页文件')
      return
    }
    setBusy(true)
    try {
      const res = await importOffline(packages, failAfter ? 2 : undefined)
      if (res.kind === 'duplicate') {
        setResult({ type: 'warning', text: `该批次（${res.batch.id}）已于 ${res.batch.at} 并入，重复提交只认第一次，本次未重复入账。` })
      } else if (res.kind === 'failed') {
        setResult({ type: 'error', text: `导入在第 ${res.batch.confirmedKeys.length} 项后中断：已保留 ${res.batch.confirmedKeys.length} 项改动（${res.batch.id}），可从最后确认项恢复，未处理项不会并入。` })
      } else {
        setResult({ type: 'success', text: `并入完成（${res.batch.id}）：新增待确认复测 ${res.batch.pendingAdded} 条，涉及 ${res.batch.confirmedKeys.length} 个问题。已有记录均未覆盖，请在下方逐项确认。` })
      }
    } finally {
      setBusy(false)
    }
  }

  const doResume = async (batch: ImportBatch) => {
    setBusy(true)
    try {
      const res = await resumeOffline(batch.id)
      if (res.kind === 'duplicate') setResult({ type: 'warning', text: `批次 ${batch.id} 已完成，无需恢复。` })
      else setResult({ type: 'success', text: `已从最后确认项恢复并完成并入（${batch.id}），累计待确认复测 ${res.batch.pendingAdded} 条。` })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复失败')
    } finally {
      setBusy(false)
    }
  }

  const batchColumns: ColumnsType<ImportBatch> = [
    { title: '批次号', dataIndex: 'id', width: 150, render: (value) => <Typography.Text code>{value}</Typography.Text> },
    { title: '并入时间', dataIndex: 'at', width: 120 },
    { title: '来源离线页', dataIndex: 'pages', render: (pages: string[]) => pages.map((page) => <Tag key={page}>{page}</Tag>) },
    { title: '状态', dataIndex: 'status', width: 90, render: (status: ImportBatch['status']) => <Tag color={status === 'done' ? 'success' : 'error'}>{status === 'done' ? '已完成' : '中断'}</Tag> },
    { title: '确认进度', width: 140, render: (_, record) => <span>{record.confirmedKeys.length} / {record.totalItems} 项</span> },
    {
      title: '操作',
      width: 160,
      render: (_, record) =>
        record.status === 'failed' ? (
          <Button size="small" type="primary" icon={<ReloadOutlined />} loading={busy} onClick={() => doResume(record)}>从最后确认项恢复</Button>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
  ]

  const pendingColumns: ColumnsType<{ issue: Issue; record: RetestRecord }> = [
    { title: '问题编号', dataIndex: ['issue', 'key'], width: 120, render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '来源离线页', dataIndex: ['record', 'source'], width: 110, render: (value?: string) => <Tag color="blue">{value ?? '未知'}</Tag> },
    { title: '结论', dataIndex: ['record', 'result'], width: 80, render: (value: string) => <Tag color={value === '通过' ? 'success' : value === '退回' ? 'error' : 'default'}>{value}</Tag> },
    { title: '复测记录', dataIndex: ['record', 'note'] },
    { title: '时间', dataIndex: ['record', 'at'], width: 120 },
    {
      title: '操作',
      width: 150,
      render: (_, entry) => (
        <Space>
          <Button size="small" type="link" onClick={() => decideRetest(entry.issue.key, entry.record.id, true)}>采纳</Button>
          <Button size="small" type="link" danger onClick={() => decideRetest(entry.issue.key, entry.record.id, false)}>忽略</Button>
        </Space>
      ),
    },
  ]

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">OFFLINE MERGE / 离线并入</p>
          <h1>断网复测结果带回合并</h1>
          <p className="muted">按问题编号并入两页离线结果；同一问题两页都有新复测时保留两份待确认，不覆盖台账已有记录。</p>
        </div>
        <Space>
          <Tag color="orange">{pendingEntries.length} 条待确认</Tag>
          <Tag color="red">{blockingCount} 项阻塞</Tag>
          <Tag color="gold">{invalidatedCount} 项证据失效</Tag>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="并入规则"
        description="按问题编号对齐：已有记录只追加、不覆盖；同一问题在多个离线页都出现新复测时，各页记录全部保留并标记「待确认」，采纳后才重算问题状态。导入中断时保留已确认项改动，可从最后确认项续跑；同一批文件重复提交只认第一次。"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 14, marginBottom: 14 }}>
        <div className="panel">
          <div className="panel-head"><h3>① 导出离线页</h3></div>
          <div style={{ padding: 16 }}>
            <Typography.Paragraph type="secondary">断网前导出当前台账快照，复测后随网络恢复带回。</Typography.Paragraph>
            <Space>
              <Input value={pageName} onChange={(event) => setPageName(event.target.value)} style={{ width: 160 }} placeholder="离线页名称" />
              <Button icon={<CloudDownloadOutlined />} onClick={exportCurrentPage}>导出 JSON</Button>
            </Space>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>② 并入离线页</h3><Button type="link" icon={<CloudSyncOutlined />} onClick={loadSample}>载入两页分歧示例</Button></div>
          <div style={{ padding: 16 }}>
            <Space wrap align="center">
              <Button icon={<ImportOutlined />} onClick={() => document.getElementById('offline-file-a')?.click()}>选择离线页 A</Button>
              <Typography.Text type="secondary">{fileA.name || '未选择'}</Typography.Text>
              <Button icon={<ImportOutlined />} onClick={() => document.getElementById('offline-file-b')?.click()}>选择离线页 B</Button>
              <Typography.Text type="secondary">{fileB.name || '未选择'}</Typography.Text>
              <input id="offline-file-a" type="file" accept="application/json" style={{ display: 'none' }} onChange={(event) => { void onPickFile('A', event.target.files?.[0]); event.target.value = '' }} />
              <input id="offline-file-b" type="file" accept="application/json" style={{ display: 'none' }} onChange={(event) => { void onPickFile('B', event.target.files?.[0]); event.target.value = '' }} />
            </Space>
            <div style={{ marginTop: 12 }}>
              <Checkbox checked={failAfter} onChange={(event) => setFailAfter(event.target.checked)}>模拟导入中断（处理 2 项后失败，保留改动并可恢复）</Checkbox>
            </div>
            <Button type="primary" icon={<CloudSyncOutlined />} loading={busy} onClick={doImport} style={{ marginTop: 12 }}>并入选中的离线页</Button>
          </div>
        </div>
      </div>

      {result && <Alert type={result.type} showIcon style={{ marginBottom: 14 }} message={result.text} onClose={() => setResult(null)} closable />}

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head"><h3>批次记录与恢复</h3><span className="muted">重复批次只认第一次</span></div>
        <Table rowKey="id" columns={batchColumns} dataSource={importBatches} pagination={false} locale={{ emptyText: '暂无并入批次' }} />
      </div>

      <div className="panel">
        <div className="panel-head"><h3>待确认复测（{pendingEntries.length}）</h3><span className="muted">采纳后才重算问题状态；阻塞项 {blockingCount} 个问题</span></div>
        <Table
          rowKey={(entry) => entry.record.id}
          columns={pendingColumns}
          dataSource={pendingEntries}
          pagination={false}
          locale={{ emptyText: '没有待确认记录' }}
        />
      </div>
    </section>
  )
}
