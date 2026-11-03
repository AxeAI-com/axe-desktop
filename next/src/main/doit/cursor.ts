import { BrowserWindow, type Rectangle, screen, systemPreferences } from "electron"

// Axe's cursor: while computer use clicks and types in other apps, a blue pointer with the Axe mark and
// what it's doing ("Clicking", "Typing") glides to each spot, so you can see where it works. One clear
// window covers the display the pointer is on and the page inside animates it: a spring glide with a
// short trail, a ripple on each click, a pulse while typing. It never takes clicks or focus, and fades
// out a few seconds after the last step. The design and the directions it was picked from:
// docs/design/axe-cursor.html.

export type CursorAction = "click" | "type" | "scroll" | "look"

const WORDS: Record<CursorAction, string> = { click: "Clicking", type: "Typing", scroll: "Scrolling", look: "Looking" }
const IDLE_MS = 2500

// The real Axe mark (next/resources/icon.icon/Assets/mark.svg), inlined as is, cropped to its paths.
const MARK = `<svg viewBox="188 240 645 559" aria-hidden="true"><g transform="translate(188.4 240.2) scale(3.3)"><path d="M1.57 169.21 L153.42 145.22 L138.73 104.91 L194.09 169.21Z M96.26 0.23 L41.12 143.74 L83.37 151.17 L0.00 166.97Z M195.25 166.73 L98.55 47.22 L70.99 80.10 L98.99 0.00Z" fill="#FFFFFF"/></g></svg>`

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;font:400 12.5px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
canvas{position:absolute;inset:0}
#c{position:absolute;left:0;top:0;opacity:0;transition:opacity .22s ease;will-change:transform}
#c.on{opacity:1}
#a{position:absolute;left:-2px;top:-2px;width:20px;height:24px;transform-origin:2px 2px;transition:transform .12s ease;filter:drop-shadow(0 0 5px rgba(52,56,255,.6)) drop-shadow(0 .5px .5px rgba(0,0,10,.25))}
#c.tap #a{transform:scale(.84)}
#p{position:absolute;left:17px;top:21px;display:flex;align-items:center;height:26px;padding:0 11px 0 9px;border-radius:999px;background:#060ae6;color:#fff;white-space:nowrap;letter-spacing:-.005em;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.3),0 0 0 .5px rgba(0,0,20,.2),0 0 16px rgba(52,56,255,.55);transition:box-shadow .3s ease}
#m{width:16px;height:14px;margin-right:7px;flex:none}#m svg{display:block;width:100%;height:100%}
#w{display:flex;align-items:center;overflow:hidden;max-width:0;opacity:0;transition:max-width .28s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
#c.busy #w{max-width:120px;opacity:1}
#d{width:1px;height:12px;margin:0 8px;background:rgba(255,255,255,.34);flex:none}
#t{color:rgba(255,255,255,.8);transition:opacity .14s ease}
#c.typing #p{animation:pulse 1.1s ease-in-out infinite}
#c.typing #a{animation:breathe 1.1s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:inset 0 0 0 .5px rgba(255,255,255,.4),0 0 0 .5px rgba(0,0,20,.2),0 0 26px rgba(52,56,255,.9)}}
@keyframes breathe{50%{transform:scale(1.06)}}
.r{position:absolute;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid #4c50ff;box-shadow:0 0 0 .5px rgba(255,255,255,.35),0 0 12px rgba(52,56,255,.7),inset 0 0 8px rgba(52,56,255,.4);pointer-events:none;animation:ripple .5s cubic-bezier(.2,.7,.3,1) forwards}
@keyframes ripple{from{transform:scale(.2);opacity:.95}to{transform:scale(1);opacity:0}}
.still .r{animation:fade .4s ease forwards}
@keyframes fade{from{transform:scale(.7);opacity:.8}to{transform:scale(.7);opacity:0}}
.still #c.typing #p,.still #c.typing #a{animation:none}
</style></head><body><canvas id="trail"></canvas><div id="c"><svg id="a" viewBox="0 0 20 24"><path d="M2 1.6v17.6l4.7-4.5 3 7.1 3.1-1.3-3-7h6.6z" fill="#060ae6" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div id="p"><span id="m">${MARK}</span><span>Axe AI</span><span id="w"><span id="d"></span><span id="t"></span></span></div></div>
<script>
const c=document.getElementById("c"),t=document.getElementById("t"),cv=document.getElementById("trail"),g=cv.getContext("2d")
let x=0,y=0,vx=0,vy=0,tx=0,ty=0,raf=0,last=0,settle=null,still=false,pts=[],said=0
const fit=()=>{const d=devicePixelRatio||1;cv.width=innerWidth*d;cv.height=innerHeight*d;cv.style.width=innerWidth+"px";cv.style.height=innerHeight+"px";g.setTransform(d,0,0,d,0,0)}
fit();addEventListener("resize",fit)
const draw=()=>{c.style.transform="translate3d("+x+"px,"+y+"px,0)"}
const paint=(now)=>{
  g.clearRect(0,0,innerWidth,innerHeight)
  pts=pts.filter(p=>now-p.t<120)
  if(still||pts.length<2)return
  g.lineCap="round";g.lineJoin="round"
  for(let i=1;i<pts.length;i++){
    const k=1-(now-pts[i].t)/120
    g.strokeStyle="rgba(52,56,255,"+(.42*k*k)+")";g.lineWidth=1+5*k
    g.beginPath();g.moveTo(pts[i-1].x,pts[i-1].y);g.lineTo(pts[i].x,pts[i].y);g.stroke()
  }
}
const step=(now)=>{
  const dt=Math.min(.032,(now-(last||now))/1000)||.016;last=now
  if(still){
    // Reduced motion: a short ease out, no overshoot, no trail.
    const k=1-Math.pow(.0001,dt/.18);x+=(tx-x)*k;y+=(ty-y)*k
  }else{
    // A spring, a little under damped, so it lands with a slight overshoot.
    const ax=260*(tx-x)-24*vx,ay=260*(ty-y)-24*vy
    vx+=ax*dt;vy+=ay*dt;x+=vx*dt;y+=vy*dt
    // The trail follows only real movement, so nothing lingers once it lands.
    const q=pts[pts.length-1];if(!q||Math.hypot(q.x-x,q.y-y)>.75)pts.push({x,y,t:now})
  }
  draw();paint(now)
  const near=Math.hypot(tx-x,ty-y)<1.5&&Math.hypot(vx,vy)<40
  if(near&&settle){const s=settle;settle=null;s()}
  if(near&&pts.every(p=>now-p.t>120)){x=tx;y=ty;vx=vy=0;draw();paint(now);raf=0;last=0;return}
  raf=requestAnimationFrame(step)
}
window.axe={
  place(px,py){x=tx=px;y=ty=py;vx=vy=0;pts=[];draw();paint(performance.now())},
  go(px,py,s){still=s;document.body.classList.toggle("still",s);tx=px;ty=py
    return new Promise(done=>{if(settle)settle();settle=done;if(!raf){last=0;raf=requestAnimationFrame(step)}})},
  show(){c.classList.add("on")},
  hide(){c.classList.remove("on","busy","typing")},
  say(word){
    said++
    if(!word){c.classList.remove("busy","typing");return}
    if(t.textContent!==word){t.style.opacity=c.classList.contains("busy")?"0":"1";setTimeout(()=>{t.textContent=word;t.style.opacity="1"},c.classList.contains("busy")?120:0)}
    c.classList.add("busy");c.classList.toggle("typing",word==="Typing")
  },
  tap(){
    c.classList.add("tap");setTimeout(()=>c.classList.remove("tap"),140)
    const r=document.createElement("div");r.className="r";r.style.left=tx+"px";r.style.top=ty+"px"
    document.body.appendChild(r);setTimeout(()=>r.remove(),600)
    // Back to plain "Axe AI" once the click has landed, unless the next step already said something.
    const n=said;setTimeout(()=>{if(said===n)axe.say("")},700)
  },
}
</script></body></html>`

let win: BrowserWindow | undefined
let ready: Promise<void> | undefined
let area: Rectangle | undefined
let at: { x: number; y: number } | undefined
let idle: ReturnType<typeof setTimeout> | undefined
let gone: ReturnType<typeof setTimeout> | undefined

const off = () => !!process.env.AXE_HEADLESS || process.platform !== "darwin"
const still = () => systemPreferences.getAnimationSettings?.().prefersReducedMotion ?? false

function make(): BrowserWindow {
  const w = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    alwaysOnTop: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  })
  w.setIgnoreMouseEvents(true)
  w.setAlwaysOnTop(true, "screen-saver")
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  // Kept out of screenshots, so Do it never sees its own pointer. A demo recording (AXE_DEMO_FOLDER) films it.
  w.setContentProtection(!process.env.AXE_DEMO_FOLDER)
  ready = new Promise((done) => w.webContents.once("did-finish-load", () => done()))
  void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
  w.on("closed", () => {
    win = undefined
    area = undefined
  })
  return w
}

async function run<T = unknown>(js: string): Promise<T | undefined> {
  if (!win || win.isDestroyed()) return undefined
  await ready
  return (win.webContents.executeJavaScript(js) as Promise<T>).catch(() => undefined)
}

const nearest = (p: { x: number; y: number }) => screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }).bounds
const same = (a?: Rectangle, b?: Rectangle) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** Covers the display with the window, and says where a screen point sits inside it. */
function cover(w: BrowserWindow, b: Rectangle, p: { x: number; y: number }): { x: number; y: number } {
  if (!same(area, b)) {
    w.setBounds(b)
    area = b
  }
  return { x: p.x - b.x, y: p.y - b.y }
}

function keepAlive() {
  if (idle) clearTimeout(idle)
  idle = setTimeout(hideCursor, IDLE_MS)
}

/** Glides Axe's cursor to a point on screen (points from the top left of the main display), saying what it's about to do. */
export async function moveCursor(x: number, y: number, action?: CursorAction): Promise<void> {
  if (off()) return
  const w = (win ??= make())
  if (gone) clearTimeout(gone)
  gone = undefined
  if (idle) clearTimeout(idle)
  // The first move starts from where your pointer is, so it reads as Axe taking over from there.
  const from = at ?? screen.getCursorScreenPoint()
  const display = nearest({ x, y })
  const fresh = !w.isVisible() || !same(area, display)
  const to = cover(w, display, { x, y })
  if (fresh) {
    // From another display it appears at the spot instead of sliding across.
    const start = same(nearest(from), display) ? { x: from.x - display.x, y: from.y - display.y } : to
    await run(`axe.place(${start.x},${start.y})`)
    if (!w.isVisible()) w.showInactive()
    await run("axe.show()")
  }
  await run(`axe.say(${JSON.stringify(action ? WORDS[action] : "")})`)
  // The page says when the glide lands; a stalled page never holds up the click.
  await Promise.race([run(`axe.go(${to.x},${to.y},${still()})`), new Promise((done) => setTimeout(done, 900))])
  at = { x, y }
  keepAlive()
}

/** Changes what the label says while the cursor is up, without moving it. No action: plain "Axe AI". */
export function cursorDoing(action?: CursorAction) {
  if (off() || !win?.isVisible()) return
  void run(`axe.say(${JSON.stringify(action ? WORDS[action] : "")})`)
  keepAlive()
}

/** A small press and a ripple ring, as the click lands; the label goes back to "Axe AI" just after. */
export function tapCursor() {
  if (!win?.isVisible()) return
  void run("axe.tap()")
  keepAlive()
}

export function hideCursor() {
  at = undefined
  if (!win?.isVisible()) return
  void run("axe.hide()")
  gone = setTimeout(() => {
    gone = undefined
    if (!at) win?.hide()
  }, 260)
}
