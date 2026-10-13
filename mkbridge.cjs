// Temp: CEO self-login bridge (raw token, as Login.jsx stores it).
const fs = require('fs');
const root = 'D:/Techins Portal/technis-work-portal-05';
const env = {};
for (const line of fs.readFileSync(root + '/server/.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const html = '<!doctype html><html><body><p id="st">working</p><script>'
  + '(async()=>{try{'
  + 'const r=await fetch("http://localhost:5000/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},'
  + 'body:JSON.stringify({email:' + JSON.stringify(env.CEO_EMAIL.trim()) + ',password:' + JSON.stringify(env.CEO_PASSWORD.trim()) + '})});'
  + 'const j=await r.json();'
  + 'if(!j.token){document.title="LOGIN_FAIL";return;}'
  + 'localStorage.setItem("token",j.token);'
  + 'const m=await(await fetch("http://localhost:5000/api/auth/me",{headers:{Authorization:"Bearer "+j.token}})).json();'
  + 'localStorage.setItem("user",JSON.stringify(m.user||{}));'
  + 'localStorage.setItem("role",(m.user&&m.user.role)||"admin");'
  + 'document.title="BRIDGE_OK";'
  + '}catch(e){document.title="BRIDGE_ERR";}})();'
  + '<\/script></body></html>';
fs.writeFileSync(root + '/client/public/ceo-selflogin.html', html);
console.log('WRITTEN');
