/**
 * Self-contained dashboard page.
 *
 * No build step, no external assets: the page is served by the plugin's own
 * loopback route and talks to the same JSON endpoints the client half uses.
 * Everything user-controlled is escaped before it reaches the DOM.
 */

export function dashboardHtml(options = {}) {
  const base = options.base ?? '/dsh-optimizer'
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH 智能优化管家</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --fg:#1c1e21; --muted:#5c6670; --card:#ffffff; --line:#e3e6ea; --accent:#2f6feb; --ok:#1a7f45; --warn:#9a6700; --bad:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16181c; --fg:#e9ecf1; --muted:#9aa4b2; --card:#1e2228; --line:#2c323b; --accent:#7aa2ff; --ok:#57c78b; --warn:#e2b34a; --bad:#ef7d74; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px; background:var(--bg); color:var(--fg); font:14px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; }
  h2 { font-size:15px; margin:26px 0 10px; color:var(--muted); font-weight:600; letter-spacing:.02em; }
  .sub { color:var(--muted); font-size:12.5px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:12px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .card .k { color:var(--muted); font-size:12px; }
  .card .v { font-size:22px; font-weight:650; margin-top:4px; font-variant-numeric:tabular-nums; }
  .card .h { font-size:11.5px; color:var(--muted); margin-top:4px; }
  table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th,td { text-align:left; padding:8px 12px; border-bottom:1px solid var(--line); font-size:12.5px; font-variant-numeric:tabular-nums; }
  th { color:var(--muted); font-weight:600; background:transparent; }
  tr:last-child td { border-bottom:none; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  button { font:inherit; padding:7px 13px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--fg); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11.5px; border:1px solid var(--line); color:var(--muted); }
  .pill.ok { color:var(--ok); border-color:color-mix(in srgb,var(--ok) 40%,transparent); }
  .pill.warn { color:var(--warn); border-color:color-mix(in srgb,var(--warn) 40%,transparent); }
  .pill.bad { color:var(--bad); border-color:color-mix(in srgb,var(--bad) 40%,transparent); }
  .bar { height:8px; border-radius:99px; background:var(--line); overflow:hidden; margin-top:8px; }
  .bar > i { display:block; height:100%; background:var(--accent); }
  .bar.warn > i { background:var(--warn); } .bar.bad > i { background:var(--bad); }
  .list { margin:0; padding-left:18px; color:var(--fg); }
  .list li { margin:4px 0; font-size:12.5px; }
  .muted { color:var(--muted); }
  footer { margin-top:30px; color:var(--muted); font-size:11.5px; }
  code { background:color-mix(in srgb,var(--muted) 15%,transparent); padding:1px 5px; border-radius:5px; font-size:11.5px; }
</style>
</head>
<body>
  <div class="row" style="justify-content:space-between">
    <div>
      <h1>DSH 智能优化管家</h1>
      <div class="sub" id="sub">加载中…</div>
    </div>
    <div class="row">
      <button id="pause">暂停监控</button>
      <button id="resume">恢复</button>
      <button id="report">生成报告</button>
      <button id="refresh" class="primary">刷新</button>
    </div>
  </div>

  <h2>今日</h2>
  <div class="grid" id="today"></div>

  <h2>预算</h2>
  <div class="grid" id="budgets"></div>

  <h2>近 14 天</h2>
  <table><thead><tr><th>日期</th><th>请求</th><th>输入</th><th>缓存命中</th><th>未命中</th><th>输出</th><th>命中率</th><th>估算费用</th></tr></thead><tbody id="series"></tbody></table>

  <h2>优化动作（今日）</h2>
  <div class="grid" id="metrics"></div>

  <h2>系统提示词</h2>
  <div id="prompt" class="muted">尚无数据（等待下一次请求组装）</div>

  <h2>异常</h2>
  <div id="anomalies" class="muted">暂无异常</div>

  <h2>检查点</h2>
  <div id="checkpoints" class="muted">暂无检查点</div>

  <h2>模块</h2>
  <div id="modules" class="muted">—</div>

  <footer>
    本地只读监控 + 本地 JSON 接口；费用为公开价格表估算，非供应商账单。状态目录：<code id="stateRoot">—</code>
  </footer>

<script>
const BASE = ${JSON.stringify(base)};
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (value) => Number(value ?? 0).toLocaleString('en-US');
const usd = (value) => '$' + Number(value ?? 0).toFixed(4);
const pct = (value) => (Number(value ?? 0) * 100).toFixed(1) + '%';
const cls = (state) => state === 'over' ? 'bad' : state === 'warn' ? 'warn' : 'ok';

function card(label, value, hint) {
  return '<div class="card"><div class="k">' + esc(label) + '</div><div class="v">' + esc(value) + '</div>' + (hint ? '<div class="h">' + esc(hint) + '</div>' : '') + '</div>';
}

function budgetCard(name, scope) {
  const pctValue = Math.min(100, Math.round((scope?.ratio ?? 0) * 100));
  return '<div class="card"><div class="k">' + esc(name) + ' <span class="pill ' + cls(scope?.state) + '">' + esc(scope?.state ?? '-') + '</span></div>'
    + '<div class="v">' + usd(scope?.usedUSD) + ' <span class="muted" style="font-size:12px">/ ' + usd(scope?.limitUSD) + '</span></div>'
    + '<div class="bar ' + cls(scope?.state) + '"><i style="width:' + pctValue + '%"></i></div></div>';
}

async function post(action, payload) {
  const response = await fetch(BASE + '/action.json', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...(payload || {}) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error((body.errors || []).join('; ') || ('HTTP ' + response.status));
  return body;
}

async function load() {
  const response = await fetch(BASE + '/state.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('state ' + response.status);
  const state = await response.json();
  const plugin = state.plugin || {};
  $('sub').textContent = 'v' + plugin.version + ' · ' + (plugin.enabled ? '已启用' : '已禁用') + ' · 模式 ' + plugin.mode
    + (plugin.paused ? ' · 已暂停（' + (plugin.pauseReason || '') + '）' : '') + ' · 运行 ' + Math.round((plugin.uptimeMs || 0) / 60000) + ' 分钟';
  $('stateRoot').textContent = plugin.stateRoot || '—';

  const today = state.ledger?.today || {};
  $('today').innerHTML = [
    card('请求数', num(today.requests)),
    card('输入 Token', num(today.inputTokens), '含缓存命中'),
    card('缓存命中', num(today.cachedInputTokens), pct(today.cacheHitRate)),
    card('未命中输入', num(today.uncachedInputTokens)),
    card('输出 Token', num(today.outputTokens)),
    card('估算费用', usd(today.costUSD), state.ledger?.pricingVersion || ''),
  ].join('');

  const scopes = state.budget?.scopes || {};
  $('budgets').innerHTML = [
    budgetCard('今日预算', scopes.day),
    budgetCard('项目预算', scopes.project),
  ].join('') + (scopes.tasks || []).slice(0, 2).map((task) => budgetCard('任务 ' + String(task.id).slice(0, 10), task)).join('');

  $('series').innerHTML = (state.ledger?.series || []).slice(-14).map((day) =>
    '<tr><td>' + esc(day.day) + '</td><td>' + num(day.requests) + '</td><td>' + num(day.inputTokens) + '</td><td>' + num(day.cachedInputTokens)
    + '</td><td>' + num(day.uncachedInputTokens) + '</td><td>' + num(day.outputTokens) + '</td><td>' + pct(day.cacheHitRate) + '</td><td>' + usd(day.costUSD) + '</td></tr>'
  ).join('') || '<tr><td colspan="8" class="muted">暂无记录</td></tr>';

  const metrics = state.ledger?.metrics?.today || {};
  $('metrics').innerHTML = [
    card('工具结果精简', num(metrics.toolResultsPruned) + ' 次', num(metrics.toolCharsPruned) + ' 字符'),
    card('重复结果去重', num(metrics.toolResultsDeduped) + ' 次'),
    card('提示词裁剪', num(metrics.promptSectionsTrimmed) + ' 段'),
    card('检查点', num(metrics.checkpoints) + ' 次'),
    card('异常告警', num(metrics.anomalies) + ' 条'),
  ].join('');

  const prompt = state.prompt?.latest;
  $('prompt').innerHTML = prompt
    ? '<div class="grid">' + card('提示词估算', num(prompt.totalTokensEst) + ' tokens', prompt.sectionCount + ' 段 / ' + prompt.toolCount + ' 个工具')
      + card('重复块', String(prompt.duplicates?.length || 0) + ' 组', '可裁剪') + '</div>'
      + '<ul class="list">' + (prompt.sections || []).slice(0, 6).map((section) => '<li>' + esc(section.name) + ' — ' + num(section.tokens) + ' tokens</li>').join('') + '</ul>'
    : '尚无数据';

  const anomalies = state.anomalies?.recent || [];
  $('anomalies').innerHTML = anomalies.length
    ? '<ul class="list">' + anomalies.slice(0, 10).map((alert) => '<li><span class="pill ' + (alert.severity === 'critical' ? 'bad' : alert.severity === 'warn' ? 'warn' : 'ok') + '">' + esc(alert.kind) + '</span> ' + esc(alert.message) + ' <span class="muted">' + esc(alert.ts) + '</span></li>').join('') + '</ul>'
    : '暂无异常';

  const checkpoints = state.checkpoints?.items || [];
  $('checkpoints').innerHTML = checkpoints.length
    ? '<ul class="list">' + checkpoints.slice(0, 8).map((item) => '<li>' + esc(item.taskId) + ' · ' + esc(item.status) + ' · risk=' + esc(item.risk) + ' · ' + esc(item.updatedAt) + '</li>').join('') + '</ul>'
    : '暂无检查点';

  $('modules').innerHTML = '<div class="row">' + (state.modules || []).map((module) =>
    '<span class="pill ' + (module.state === 'mounted' ? 'ok' : module.state === 'failed' ? 'bad' : 'warn') + '">' + esc(module.id) + ': ' + esc(module.state) + '</span>'
  ).join('') + '</div>';

  document.getElementById('pause').disabled = Boolean(plugin.paused);
  document.getElementById('resume').disabled = !plugin.paused;
}

$('refresh').onclick = () => load().catch((error) => { $('sub').textContent = '刷新失败：' + error.message; });
$('pause').onclick = () => post('pause', { reason: '面板手动暂停' }).then(load).catch((error) => alert(error.message));
$('resume').onclick = () => post('resume').then(load).catch((error) => alert(error.message));
$('report').onclick = () => post('report').then((result) => alert('已生成报告：\\n' + (result.files || []).join('\\n'))).catch((error) => alert(error.message));
setInterval(() => load().catch(() => {}), 5000);
load().catch((error) => { $('sub').textContent = '加载失败：' + error.message; });
</script>
</body>
</html>`
}
