export const APPLE_ID_GUIDE_IMAGES = [
  { file: '01.png', width: 1800, height: 1164, title: '账号、密码与密保资料的格式', phone: false },
  { file: '08.jpg', width: 1800, height: 1459, title: '在 Apple 官方页面核对本单账号', phone: false },
  { file: '09.jpg', width: 1800, height: 1720, title: '按账号实际要求处理安全验证', phone: false },
  { file: '11.jpg', width: 1800, height: 2184, title: '更改密码与检查安全资料', phone: false },
  { file: '02.jpg', width: 1040, height: 1636, title: '设置中打开自己的姓名', phone: true },
  { file: '03.jpg', width: 1040, height: 1777, title: '进入媒体与购买项目', phone: true },
  { file: '04.jpg', width: 1040, height: 1922, title: '只退出媒体与购买项目中的账号', phone: true },
  { file: '05.jpg', width: 1040, height: 1898, title: '选择使用其他商店账号', phone: true },
  { file: '06.jpg', width: 1040, height: 1503, title: '可选安全升级中的其他选项', phone: true },
  { file: '07.jpg', width: 1040, height: 1918, title: '可选升级的确认界面', phone: true },
  { file: '10.jpg', width: 1800, height: 2151, title: '可选操作：更改登录邮箱', phone: false },
] as const

export const appleIdGuideImage = (index: number) => '/guides/apple-id/' + APPLE_ID_GUIDE_IMAGES[index].file

export const APPLE_ID_LOGIN_STEPS = [
  { title: '进入自己的账户设置', text: '打开“设置”，点顶部你自己的姓名。此时仍保留原 iCloud 账号；若设备还没设置个人主账号，先完成自己的设备设置，不要把所购下载账号填到“登录 iPhone”中。', images: [4] },
  { title: '找到商店账号入口', text: '选择“媒体与购买项目”。它用于 App Store 等媒体服务，与 iCloud 主账户分开；不要点 iCloud、“查找”或整个账户页面底部的退出登录。', images: [5] },
  { title: '需要切换时，只退出购买账号', text: '若这里已登录另一个商店账号，在“媒体与购买项目”的弹出菜单内退出。这里尚未登录，或已经是本次要使用的账号，就跳过这一步。', images: [6] },
  { title: '填入本单的商店账号', text: '再次打开“媒体与购买项目”。若系统询问是否使用手机主账号，选择“不是 [你的姓名]？”或其他账号入口，再输入交付账号与修改后的密码。', images: [7] },
  { title: '按实际页面完成安全验证', text: '若出现可选的安全升级，页面可能提供“其他选项”→“不升级”；这只是选择是否升级，不能跳过已有双重认证。要求验证码时，须使用该账号的受信任设备或号码完成验证；若必须绑定新号码，使用本人可长期收码的号码。', images: [8, 9] },
  { title: '核对商店邮箱，再去下载', text: '完成后，回到“媒体与购买项目”检查邮箱是否为本单账号，再打开 App Store。设备顶部的 iCloud 主账户应仍是你原来的个人账号。', images: [] },
] as const

export const APPLE_ID_GUIDE_FAQ = [
  { question: '一直转圈或提示无法登录，先查什么？', answer: '先核对是否在“媒体与购买项目”登录、账号密码有没有多余空格。可换一个稳定网络重试，避免连续猜密码；原单资料在 Apple 官方页面也无法通过验证时，保存错误提示联系售后。网络暂时不可用与账号密码错误应分别核对。' },
  { question: '更新应用时为什么仍要求原来的账号？', answer: '该 App 可能由另一个账号下载或购买。先用原下载账号更新；需要重装时，先备份应用内数据、确认新账号能下载及对应付费权益，再决定操作。重装 App 不能解锁被停用的 Apple 账户。' },
  { question: '免费 App、付费 App 和已购账号怎么区分？', answer: '普通下载账号不等于所有应用免费。付费 App 和应用内订阅分别收费；只有商品明确写明的已购项目包含对应记录，例如 Shadowrocket 已购账号。是否在该地区上架，以 App Store 当前显示为准。' },
  { question: '图里的按钮和我的设备不一样怎么办？', answer: '图片为操作示意，系统版本、地区和账号安全状态会影响按钮。按“媒体与购买项目”“账户安全”等相同含义的入口操作；找不到可选项时不要假定能跳过验证，先保留当前页面提示核对。' },
] as const
