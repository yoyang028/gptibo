const form = document.querySelector('form')
const message = document.querySelector('#status')
const tbody = document.querySelector('tbody')
let validationError = ''
async function refresh() {
  try {
    const state = await (await fetch('/api/status')).json()
    form.elements.key.required = !state.keyReceived
    form.elements.key.placeholder = state.keyReceived
      ? 'Key 已在本机预置，可留空'
      : '从小久后台复制 64 位 API Key'
    message.textContent =
      validationError ||
      state.error ||
      (state.running
        ? `正在读取目录，已读取 ${state.pagesRead || 0} 页…`
        : state.ready
          ? `目录已就绪：${state.items.length} 个规格，钱包余额 ¥${(state.balanceCents / 100).toFixed(2)}`
          : state.configured
            ? '已保存凭据，可点击重新查询。'
            : state.keyReceived
              ? 'Key 已预置，只需填写配对的完整 Secret 并点击保存。'
              : '请填写采购 API Key 和 Secret。')
    form.querySelector('button').disabled = state.running
    document.querySelector('#recheck').disabled =
      state.running || !state.configured
    tbody.replaceChildren()
    for (const item of state.items || []) {
      const tr = document.createElement('tr')
      for (const value of [
        item.name,
        item.specification || item.skuCode || item.skuId,
        `¥${(item.priceCents / 100).toFixed(2)}`,
        item.available ? (item.stock === -1 ? '不限量' : item.stock) : '缺货',
        `${item.productId} / ${item.skuId}`,
      ]) {
        const td = document.createElement('td')
        td.textContent = value
        tr.append(td)
      }
      tbody.append(tr)
    }
  } catch {
    message.textContent = '本机连接中断，请保留此页。'
  }
}
form.addEventListener('input', () => {
  validationError = ''
})
form.addEventListener('submit', async (event) => {
  event.preventDefault()
  validationError = ''
  const data = {
    key: form.elements.key.value,
    secret: form.elements.secret.value,
  }
  try {
    const response = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const result = await response.json()
    if (!response.ok) {
      validationError = result.error
      message.textContent = validationError
    } else {
      form.reset()
      await refresh()
    }
  } catch {
    validationError = '本机保存失败，请重新检查。'
    message.textContent = validationError
  }
})
document.querySelector('#recheck').onclick = async () => {
  validationError = ''
  await fetch('/api/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  await refresh()
}
setInterval(refresh, 1500)
refresh()
