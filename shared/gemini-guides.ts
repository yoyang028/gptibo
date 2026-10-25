export type GeminiGuideKind = 'student' | 'activation' | 'region' | 'extension'
export const GEMINI_GUIDE_TITLES:Record<GeminiGuideKind,string> = {
  student:'Gemini 学生认证与开通教程',activation:'Gemini 18 个月激活与权益核对',region:'Gemini 地区与套餐问题图解',
  extension:'Gemini 学生优惠领取、升级与续费图解',
}
const regionImages = [
  {file:'01.jpg',height:1315,title:'核对错误提示与当前 Google 账号'},
  {file:'02.png',height:1793,title:'查看 Google Play 当前国家与地区'},
  {file:'04.jpg',height:1740,title:'查看付款资料所属地区与关联服务'},
  {file:'10.jpg',height:2015,title:'处理 Google 官方要求的付款验证'},
  {file:'15.png',height:1974,title:'在原活动页面核对领取条件'},
  {file:'16.png',height:1816,title:'在 Google One 核对生效方案与日期'},
  {file:'17.png',height:1990,title:'认证通过后套餐不一致的核对清单'},
] as const
export const GEMINI_GUIDE_IMAGES = [
  ...regionImages.map(image=>({...image,width:1800,path:'/guides/gemini-region/'+image.file})),
  {file:'04.png',height:845,width:1200,title:'学生免费领取与付费组合套餐对照',path:'/guides/gemini-student/04.png'},
] as const
export const geminiGuideImage=(index:number)=>GEMINI_GUIDE_IMAGES[index].path
