import { useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Empty, Progress, Row, Space, Table, Tag, Timeline, Typography, Upload, message } from 'antd'
import {
  CheckCircleOutlined,
  CloudSyncOutlined,
  CopyOutlined,
  DisconnectOutlined,
  RedoOutlined,
  ReloadOutlined,
  UploadOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useIssues } from '../api/useIssues'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { offlinePages } from '../api/offlineSeed'
import { countBlocked, countPending, pendingRecords } from '../api/merge'
import type { Issue, OfflinePage, RetestRecord } from '../api/types'

const verdictColor: Record<string, string> = { 通过: 'success', 退回: 'error', 不适用: 'default' }

export default function SyncPage() {
  useIssues()
  const issues = useWorkspaceStore((state) => state.issues)
  const progress = useWorkspaceStore((state) => state.progress)
  const syncPage = useWorkspaceStore((state) => state.syncPage)
  const resumePage = useWorkspaceStore((state) => state.resumePage)
  const decideRecord = useWorkspaceStore((state) => state.decideRecord)
  const resetSync = useWorkspaceStore((state) => state.resetSync)
  const offlineDirty = useWorkspaceStore((state) => state.offlineDirty)
  const [busy, setBusy] = useState<string | null>(null)
  const [extraPages, setExtraPages] = useState<OfflinePage[]>([])
  const pages = [...offlinePages, ...extraPages]

  const pendingTotal = countPending(issues)
  const blockedTotal = countBlocked(issues)
  const invalidations = useMemo(() => issues.flatMap((issue) => issue.invalidations.filter((inv) => inv.active).map((inv) => ({ issue, inv }))), [issues])

  const anyInterrupted = Object.values(progress).some((item) => item.status === 'interrupted')

  const importFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as OfflinePage | OfflinePage[]
        const list = Array.isArray(parsed) ? parsed : [parsed]
        if (!list.every((page) => page.pageId && Array.isArray(page.submissions))) throw new Error('bad shape')
        setExtraPages((current) => {
          const known = new Set([...offlinePages.map((page) => page.pageId), ...current.map((page) => page.pageId)])
          return [...current, ...list.filter((page) => !known.has(page.pageId))]
        })
        message.success(`已载入 ${list.length} 页断网结果，可按编号并入`)
      } catch {
        message.error('文件格式不符：需要断网结果页 JSON（pageId + submissions）')
      }
    }
    reader.readAsText(file)
    return false
  }

  const run = async (page: OfflinePage, resume: boolean) => {
    setBusy(page.pageId)
    try {
      if (resume) await resumePage(page)
      else await syncPage(page)
      const after = useWorkspaceStore.getState().progress[page.pageId]
      if (after?.status === 'interrupted') message.warning(`并入在第 ${after.applied + 1} 项中断，已保留改动，可从最后确认项恢复`)
      else message.success(`「${page.pageLabel}」并入完成`)
    } finally {
      setBusy(null)
    }
  }

  const decide = async (issueKey: string, recordId: string, decision: '已采纳' | '已驳回') => {
    if (anyInterrupted) {
      message.warning('存在中断的并入，请先从最后确认项恢复后再确认复测')
      return
    }
    await decideRecord(issueKey, recordId, decision)
    message.success(decision === '已采纳' ? '已采纳并按结论重算状态' : '已驳回，保留记录且不改变状态')
  }

  const pendingRows = issues.flatMap((issue) =>
    pendingRecords(issue).map((record) => ({ issue, record })),
  )

  const pendingColumns: ColumnsType<{ issue: Issue; record: RetestRecord }> = [
    {
      title: '问题编号 / 来源页',
      width: 220,
      render: (_, { issue, record }) => (
        <div>
          <Typography.Text strong>{issue.key}</Typography.Text>
          <div style={{ fontSize: 12 }}>{issue.title}</div>
          <Tag icon={<CopyOutlined />} color="geekblue" style={{ marginTop: 4 }}>{record.sourcePage ?? '在线'}</Tag>
        </div>
      ),
    },
    { title: '复测人', dataIndex: ['record', 'actor'], width: 130 },
    { title: '结论', width: 80, render: (_, { record }) => <Tag color={verdictColor[record.result]}>{record.result}</Tag> },
    { title: '复测记录', render: (_, { record }) => <span>{record.note}<br /><Typography.Text type="secondary" style={{ fontSize: 11 }}>{record.at} · {record.submissionId}</Typography.Text></span> },
    {
      title: '操作',
      width: 150,
      render: (_, { issue, record }) => (
        <Space direction="vertical" size={4}>
          <Button size="small" type="primary" ghost onClick={() => decide(issue.key, record.id, '已采纳')}>采纳并重算</Button>
          <Button size="small" danger ghost onClick={() => decide(issue.key, record.id, '已驳回')}>驳回保留</Button>
        </Space>
      ),
    },
  ]

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">OFFLINE MERGE / 断网结果合并</p>
          <h1>两页断网结果按问题编号并入</h1>
          <p className="muted">恢复网络后逐条并入；同一问题两页都新增复测时两份都保留待确认，不覆盖已有记录。</p>
        </div>
        <Space>
          <Badge count={pendingTotal} showZero color="#d48806"><Tag color="orange" style={{ padding: '4px 12px' }}>待确认复测</Tag></Badge>
          <Badge count={blockedTotal} showZero color="#cf1322"><Tag color="error" style={{ padding: '4px 12px' }}>阻塞项</Tag></Badge>
          <Button icon={<ReloadOutlined />} onClick={async () => { await resetSync(); setExtraPages([]); message.success('演示数据已重置') }}>重置演示</Button>
          <Upload accept="application/json" showUploadList={false} beforeUpload={importFile}>
            <Button icon={<UploadOutlined />}>导入断网结果 JSON</Button>
          </Upload>
        </Space>
      </div>

      {offlineDirty && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="存在已落地但未全部确认的断网改动"
          description="本地改动已保留，系统不会用服务端旧快照覆盖。请先处理中断项并完成待确认复测，清单与报告口径才会解除阻塞。"
        />
      )}

      <Row gutter={14}>
        {pages.map((page) => {
          const state = progress[page.pageId]
          const pct = state ? Math.round((state.applied / page.submissions.length) * 100) : 0
          const interrupted = state?.status === 'interrupted'
          const done = state?.status === 'done'
          return (
            <Col xs={24} lg={12} key={page.pageId}>
              <Card
                title={<Space><CloudSyncOutlined />{page.pageLabel}</Space>}
                extra={
                  done ? <Tag icon={<CheckCircleOutlined />} color="success">已并入</Tag>
                    : interrupted ? <Tag icon={<DisconnectOutlined />} color="error">已中断</Tag>
                    : state ? <Tag color="processing">并入中</Tag> : <Tag>待并入</Tag>
                }
                style={{ marginBottom: 14 }}
              >
                <Typography.Text type="secondary">采集于 {page.capturedAt} · 共 {page.submissions.length} 条提交</Typography.Text>
                <Progress percent={state ? pct : 0} status={interrupted ? 'exception' : done ? 'success' : 'active'} style={{ marginTop: 10 }} />
                <Timeline
                  style={{ marginTop: 12, marginBottom: 8 }}
                  items={page.submissions.map((sub) => {
                    const isCheckpoint = interrupted && state.applied === page.submissions.indexOf(sub)
                    return {
                      color: isCheckpoint ? 'red' : (state && state.applied > page.submissions.indexOf(sub)) ? 'green' : 'gray',
                      children: (
                        <span>
                          <Typography.Text strong>{sub.issueKey}</Typography.Text>
                          {sub.retest && <Tag color={verdictColor[sub.retest.result]} style={{ marginInline: 6 }}>{sub.retest.result}</Tag>}
                          {sub.evidenceUpdate && <Tag color="purple">证据更新</Tag>}
                          {sub.newIssue && <Tag color="cyan">新问题</Tag>}
                          {isCheckpoint && <Tag icon={<WarningOutlined />} color="error">断点 · 最后确认项之后</Tag>}
                          <div style={{ fontSize: 12 }} className="muted">{sub.submissionId}</div>
                        </span>
                      ),
                    }
                  })}
                />
                {state?.duplicates > 0 && <Alert type="info" showIcon style={{ marginBottom: 10 }} message={`识别并跳过 ${state.duplicates} 条重复提交（只认第一次）`} />}
                {interrupted && (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 10 }}
                    message={`并入中断：${state.error}`}
                    description={`已保留前 ${state.applied} 项改动，恢复时从第 ${state.applied + 1} 项（最后确认项之后）继续，不会重复提交前序内容。`}
                  />
                )}
                <Space>
                  {interrupted
                    ? <Button type="primary" icon={<RedoOutlined />} loading={busy === page.pageId} onClick={() => run(page, true)}>从最后确认项恢复</Button>
                    : <Button type="primary" icon={<CloudSyncOutlined />} loading={busy === page.pageId} disabled={Boolean(state)} onClick={() => run(page, false)}>{state ? '已并入' : '恢复网络并按编号并入'}</Button>}
                  {done && <Typography.Text type="secondary">已确认 {state.applied} 项 · 重复 {state.duplicates} 项</Typography.Text>}
                </Space>
              </Card>
            </Col>
          )
        })}
      </Row>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <h3>待确认复测（{pendingRows.length}）</h3>
          <span className="muted">同一问题两页都新增时各保留一份，逐条采纳或驳回，系统不做覆盖合并</span>
        </div>
        <div className="table-wrap">
          {pendingRows.length === 0 ? (
            <Empty style={{ padding: 24 }} description="暂无待确认复测，并入两页结果后在此逐项确认" />
          ) : (
            <Table rowKey={(row) => row.record.id} columns={pendingColumns} dataSource={pendingRows} pagination={false} />
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>证据更新导致的失效来源（{invalidations.length}）</h3><Tag color="purple">旧已通过立即失效并重算</Tag></div>
        <div style={{ padding: 16 }}>
          {invalidations.length === 0 ? (
            <Typography.Text type="secondary">暂无失效记录。并入含「证据更新」的页面后，旧的已通过结论会立即失效并回到待复测。</Typography.Text>
          ) : (
            invalidations.map(({ issue, inv }) => (
              <div className="timeline-item" key={inv.id}>
                <Typography.Text strong>{issue.key} · {issue.title}</Typography.Text>
                <div>{inv.reason}</div>
                <div style={{ fontSize: 12 }}>
                  <Typography.Text delete type="secondary">{inv.evidenceBefore}</Typography.Text>
                  {' → '}
                  <Typography.Link href={inv.evidenceAfter} target="_blank">{inv.evidenceAfter}</Typography.Link>
                </div>
                <Space size={6} style={{ marginTop: 4 }}>
                  <Tag color="error">旧结论 {inv.recordId} 已失效</Tag>
                  <Tag>{inv.sourcePage}</Tag>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>{inv.at}</Typography.Text>
                </Space>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}
