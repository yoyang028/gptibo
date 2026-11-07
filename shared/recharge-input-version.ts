// Compatibility marker only, never authentication. New submissions must use a
// client that preserves the Session Token; old-key recovery remains unchanged.
export const RECHARGE_INPUT_VERSION = 'session-token-2'
export const RECHARGE_INPUT_VERSION_HEADER = 'X-Recharge-Input-Version'
export const RECHARGE_PAGE_UPGRADE_MESSAGE = '充值页面已更新，当前窗口仍是旧版。请刷新整个网页（不是只点“刷新进度”），从“我的订单”重新打开原订单，再粘贴完整 Session。原订单和付款保留，无需重新付款。'
