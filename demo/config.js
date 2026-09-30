/* SOD 演示云端配置（随仓库部署到 GitHub Pages）
   anon key 本就是可公开的前端凭证（RLS 只读 + RPC 白名单防护）
   换 Supabase 项目时改这里，push 后自动生效 */
window.SOD_CONFIG = {
  SUPABASE_URL: 'https://haxnoewhzlocblahtnbj.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhheG5vZXdoemxvY2JsYWh0bmJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3NTIyOTksImV4cCI6MjEwNjMyODI5OX0.CJJbGkscWpwbjH-gLuX809JH-4LuLRx4_cFo5XmYqnw'
};
