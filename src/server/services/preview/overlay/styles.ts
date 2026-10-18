/**
 * Gaya libadwaita (GTK 4) dengan palet netral KCG Code, versi ringkas:
 * header bar berjudul di tengah, toolbar tombol datar dalam kartu, boxed
 * list rapat, entry membulat, switch GTK, tombol OSD.
 *
 * Dipasang lewat constructable stylesheet (lolos CSP `style-src` app).
 */
export const CSS = `
:host{all:initial}
*{box-sizing:border-box;font-family:"Noto Sans",Cantarell,"Inter",system-ui,-apple-system,"Segoe UI",sans-serif}
.root{--window:#fafafa;--card:#ffffff;--fg:#1f1f1f;--dim:rgba(0,0,6,.55);--line:rgba(0,0,6,.08);--border:rgba(0,0,6,.22);--hover:rgba(0,0,6,.04);--active:rgba(0,0,6,.08);--tint:rgba(0,0,6,.06);--sugg:#1f1f1f;--sugg-fg:#fafafa;--danger:#c01c28;--danger-bg:rgba(224,27,36,.1);--ok:#1a7f37;--accent:#3584e4;--warn:#c88800;--shadow:0 0 0 1px rgba(0,0,6,.03),0 1px 3px 1px rgba(0,0,6,.07),0 2px 6px 2px rgba(0,0,6,.03);color:var(--fg);font-size:14px;line-height:1.4}
@media (prefers-color-scheme:dark){.root{--window:#171717;--card:#222222;--fg:#fafafa;--dim:rgba(255,255,255,.6);--line:rgba(255,255,255,.09);--border:rgba(255,255,255,.28);--hover:rgba(255,255,255,.06);--active:rgba(255,255,255,.1);--tint:rgba(255,255,255,.08);--sugg:#fafafa;--sugg-fg:#141414;--danger:#ff7b72;--danger-bg:rgba(255,123,114,.12);--ok:#57d37a;--accent:#78aeed;--warn:#f6c343;--shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 8px rgba(0,0,0,.35)}}
svg{width:18px;height:18px;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;flex:none}
button,a{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent}
button{cursor:pointer}
button:disabled{opacity:.45;cursor:default}
:focus-visible{outline:2px solid color-mix(in srgb,var(--fg) 45%,transparent);outline-offset:2px}

/* Tombol OSD melayang */
.osd{position:fixed;z-index:2147483647;width:48px;height:48px;border-radius:24px;border:0;padding:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.78);color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3);touch-action:none;user-select:none;transition:transform .22s cubic-bezier(.16,1,.3,1),opacity .18s ease-out}
/* Menyingkir saat sheet / mode pilih / anotasi terbuka */
.osd.away{opacity:0;transform:scale(.6);pointer-events:none}
.osd:active{transform:scale(.94)}
.osd.dragging{transition:none;opacity:.85}
.osd .logo{display:flex}
.osd .logo svg{width:24px;height:24px}
.osd .dot{position:absolute;right:3px;bottom:3px;width:11px;height:11px;border-radius:50%;background:var(--warn);border:2px solid rgba(0,0,0,.78);animation:pulse 1.2s ease-in-out infinite}
.osd .dot.attn{background:#ff5f57;animation:none}
.osd .badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#e01b24;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px rgba(0,0,0,.15)}
@keyframes pulse{50%{opacity:.35}}

/* Dialog (bottom sheet ala AdwDialog; mengambang di layar lebar) */
.scrim{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.4);animation:fade-in .22s ease-out}
.scrim.closing{animation:fade-out .2s ease-in forwards}
.sheet{position:fixed;z-index:2147483647;left:0;right:0;bottom:0;margin:0 auto;max-width:440px;max-height:86vh;display:flex;flex-direction:column;background:var(--window);border-radius:18px 18px 0 0;box-shadow:0 -6px 32px rgba(0,0,0,.28);overflow:hidden;animation:sheet-in .34s cubic-bezier(.16,1,.3,1)}
.sheet.closing{animation:sheet-out .22s cubic-bezier(.4,0,1,1) forwards}
@media (min-width:640px){.sheet{bottom:24px;border-radius:18px;max-height:min(86vh,640px);animation-name:pop-in;animation-duration:.28s}.sheet.closing{animation-name:pop-out;animation-duration:.16s}}
@keyframes rise{from{transform:translateY(24px);opacity:0}}
/* Pulih dari reload otomatis: tampil langsung tanpa animasi (persist.ts) */
.sheet.no-anim,.scrim.no-anim{animation:none}
.root.instant .osd{transition:none}
@keyframes fade-in{from{opacity:0}}
@keyframes fade-out{to{opacity:0}}
/* HP: meluncur dari bawah layar (kurva melambat ala GTK) */
@keyframes sheet-in{from{transform:translateY(100%)}}
@keyframes sheet-out{to{transform:translateY(100%)}}
/* Layar lebar: tumbuh dari tombol OSD (transform-origin diatur saat dibuka) */
@keyframes pop-in{from{transform:scale(.85);opacity:0}}
@keyframes pop-out{to{transform:scale(.9);opacity:0}}
.grab{width:36px;height:4px;border-radius:2px;background:var(--border);opacity:.6;margin:8px auto 0;flex:none}
@media (min-width:640px){.grab{display:none}}
.headerbar{display:grid;grid-template-columns:32px 1fr 32px;align-items:center;gap:8px;padding:6px 10px 2px;flex:none}
@media (min-width:640px){.headerbar{padding-top:10px}}
.title{min-width:0;text-align:center}
.title b{display:block;font-size:14.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.title span{display:block;font-size:12px;color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.circ{width:32px;height:32px;border-radius:16px;border:0;padding:0;background:transparent;display:flex;align-items:center;justify-content:center;color:var(--fg);flex:none}
.circ:hover{background:var(--hover)}.circ:active{background:var(--active)}
.circ.tinted{width:26px;height:26px;background:var(--tint);justify-self:end}
.circ.tinted svg{width:14px;height:14px;stroke-width:2.5}
.body{overflow-y:auto;overscroll-behavior:contain;padding:8px 12px calc(14px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:10px}

/* Toolbar: tombol datar (ikon + label) di dalam kartu */
.tools{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:2px;padding:4px;background:var(--card);border-radius:12px;box-shadow:var(--shadow)}
.tool{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:54px;padding:0 2px;border:0;border-radius:8px;background:transparent;color:var(--dim);font-size:11.5px;font-weight:600;text-decoration:none}
.tool .ti{display:flex;align-items:center;justify-content:center;height:18px;color:var(--fg)}
.tool>span:last-child{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tool:hover{background:var(--hover);color:var(--fg)}
.tool:active{background:var(--active)}
.tool[aria-pressed="true"]{background:var(--active);color:var(--fg)}

/* Status di subjudul header: titik + teks */
.title i.sd{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:1px;background:var(--dim)}
.title i.sd.ok{background:var(--ok)}
.title i.sd.busy{background:var(--warn);animation:pulse 1.2s ease-in-out infinite}
.title i.sd.bad{background:var(--danger)}
/* Titik "perlu perhatian" di ikon toolbar (mis. Chat saat agent menunggu) */
.tool .ti{position:relative}
.tool .pip{position:absolute;top:-2px;right:-5px;width:8px;height:8px;border-radius:50%;background:var(--danger);box-shadow:0 0 0 2px var(--card)}
/* Balasan terakhir agent */
.reply{padding:9px 12px;font-size:13px;line-height:1.45}
.reply small{display:block;font-size:11.5px;font-weight:600;color:var(--dim);margin-bottom:2px}

/* Grup + boxed list (rapat) */
.ghead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px 6px;min-height:26px}
.ghead h3{margin:0;font-size:13px;font-weight:700}
.boxed{background:var(--card);border-radius:12px;box-shadow:var(--shadow);overflow:hidden}
.row{display:flex;align-items:center;gap:10px;min-height:42px;padding:7px 12px;width:100%;border:0;background:transparent;text-align:left;text-decoration:none;color:var(--fg)}
.boxed>.row+.row{border-top:1px solid var(--line)}
.row .pre{display:flex;color:var(--dim)}
.row .txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.row .t{font-size:13.5px}
.row .s{font-size:12.5px;color:var(--dim)}
.row .suf{display:flex;align-items:center;color:var(--dim)}
.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere;cursor:pointer}
.clamp.full{display:block}
.mono{font-family:"Source Code Pro",ui-monospace,Menlo,monospace;font-size:12px}
.err .t{color:var(--danger);-webkit-line-clamp:2}
.err .pre{color:var(--danger)}
.flat{height:26px;padding:0 10px;border-radius:8px;border:0;background:transparent;font-size:12.5px;font-weight:700;color:var(--fg)}
.flat:hover{background:var(--hover)}
.count{min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--tint);font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;margin-left:6px;vertical-align:1px}
.ok{color:var(--ok)}
.spin{width:16px;height:16px;border:2px solid var(--line);border-top-color:var(--fg);border-radius:50%;animation:spin .8s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.osd .dot,.spin,.title i.sd,.sheet,.sheet.closing,.scrim,.scrim.closing{animation:none}.osd{transition:none}}

/* Entry pesan: satu baris membulat (lampir | teks | kirim) */
.entry{background:var(--card);border-radius:20px;box-shadow:var(--shadow);padding:4px}
.entry.off{opacity:.6}
.entry:focus-within{box-shadow:var(--shadow),0 0 0 2px color-mix(in srgb,var(--fg) 30%,transparent)}
.entrybar{display:flex;align-items:flex-end;gap:2px}
.entrybar .circ{width:34px;height:34px;border-radius:17px;color:var(--dim)}
textarea:focus-visible{outline:none}
.thumbs{display:flex;gap:8px;flex-wrap:wrap;padding:6px 6px 4px}
.thumb{position:relative;width:52px;height:52px;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1px var(--line)}
.thumb img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
.thumb button{position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:10px;border:0;background:rgba(0,0,0,.65);color:#fff;display:flex;align-items:center;justify-content:center;padding:0}
.thumb button svg{width:12px;height:12px;stroke-width:2.5}
.thumb.loading{display:flex;align-items:center;justify-content:center;background:var(--tint)}
/* Chip elemen terpilih (ikut pesan sebagai konteks) */
.chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;height:30px;padding:0 4px 0 10px;border-radius:15px;background:var(--tint);font-size:12.5px;color:var(--fg)}
.chip .pre{display:flex;color:var(--accent)}
.chip .pre svg{width:14px;height:14px}
.chip span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:"Source Code Pro",ui-monospace,Menlo,monospace;font-size:12px}
.chip small{flex:none;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px;color:var(--dim)}
.chip.flash{box-shadow:0 0 0 2px var(--accent)}
.chip button{width:22px;height:22px;border-radius:11px;border:0;padding:0;background:transparent;color:var(--dim);display:flex;align-items:center;justify-content:center;flex:none}
.chip button:hover{background:var(--hover);color:var(--fg)}
.chip button svg{width:12px;height:12px;stroke-width:2.5;color:currentColor}
textarea{flex:1;min-width:0;display:block;border:0;outline:0;resize:none;background:transparent;color:var(--fg);font-size:16px;line-height:1.4;max-height:120px;padding:6px 2px}
textarea::placeholder{color:var(--dim)}
.send{width:34px;height:34px;border-radius:17px;border:0;padding:0;background:var(--sugg);color:var(--sugg-fg);display:flex;align-items:center;justify-content:center;flex:none}
.send svg{width:16px;height:16px;stroke-width:2.5}

/* Switch GTK (baris yang seluruhnya jadi label, ala AdwSwitchRow) */
label.boxed{display:block;cursor:pointer;user-select:none}
label.boxed:hover .row{background:var(--hover)}
.switch{position:relative;width:40px;height:22px;flex:none}
.switch input{position:absolute;inset:0;margin:0;opacity:0;cursor:pointer}
.switch span{position:absolute;inset:0;border-radius:11px;background:var(--active);transition:background .15s}
.switch span::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:transform .15s}
.switch input:checked+span{background:var(--sugg)}
.switch input:checked+span::after{transform:translateX(18px);background:var(--sugg-fg)}
.switch input:focus-visible+span{outline:2px solid color-mix(in srgb,var(--fg) 45%,transparent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.switch span,.switch span::after{transition:none}}
.note{font-size:12.5px;color:var(--danger);margin:0 6px}
.hint{font-size:13px;color:var(--dim);text-align:center;margin:2px 8px}

/* Mode pilih elemen (ala inspector) */
.pick-marks{position:fixed;inset:0;z-index:2147483646;pointer-events:none}
.pick-box{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid var(--accent);border-radius:4px;box-sizing:border-box}
.pick-box.hover{background:color-mix(in srgb,var(--accent) 12%,transparent);transition:all .06s linear}
.pick-box.sel{background:color-mix(in srgb,var(--accent) 20%,transparent);box-shadow:0 0 0 1px rgba(255,255,255,.6)}
.pick-box.pre{border-style:dashed;border-width:1.5px;background:color-mix(in srgb,var(--accent) 8%,transparent)}
.pick-num{position:fixed;z-index:2147483646;pointer-events:none;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:var(--accent);color:#fff;font:700 11px/20px "Noto Sans",system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 1px 4px rgba(0,0,0,.3)}
.pick-tag{position:fixed;z-index:2147483646;pointer-events:none;max-width:216px;height:20px;padding:0 7px;border-radius:5px;background:var(--accent);color:#fff;font:600 11px/20px "Source Code Pro",ui-monospace,Menlo,monospace;white-space:pre;overflow:hidden;text-overflow:ellipsis}
.pick-area{position:fixed;z-index:2147483646;pointer-events:none;border:1.5px dashed var(--accent);border-radius:4px;background:color-mix(in srgb,var(--accent) 10%,transparent)}
.pick-layer{position:fixed;inset:0;z-index:2147483645;display:none;touch-action:none;cursor:crosshair}
.pick-layer.on{display:block}
.pick-bar{position:fixed;z-index:2147483647;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:calc(100vw - 24px);padding:6px 6px 6px 16px;border-radius:24px;background:rgba(24,24,24,.92);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);color:#fff;font-size:13.5px;font-weight:600;box-shadow:0 4px 20px rgba(0,0,0,.35);white-space:nowrap;animation:pickrise .22s cubic-bezier(.2,.9,.3,1)}
@keyframes pickrise{from{transform:translate(-50%,16px);opacity:0}}
.pick-hint{min-width:0;overflow:hidden;text-overflow:ellipsis;padding-right:4px}
.pick-hint.warn{color:#ffb3ad}
.pick-bar .pill{display:flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:16px;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:13px;font-weight:700;flex:none}
.pick-bar .pill.sugg{background:#fff;color:#141414}
.pick-bar .pill:disabled{opacity:.4}
.pick-count{min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--accent);color:#fff;font-size:11.5px;line-height:20px;text-align:center}
.seg{display:flex;padding:2px;border-radius:18px;background:rgba(255,255,255,.12);flex:none}
.seg button{height:30px;padding:0 14px;border-radius:15px;border:0;background:transparent;color:rgba(255,255,255,.7);font-size:13px;font-weight:700}
.seg button[aria-pressed="true"]{background:#fff;color:#141414}
/* HP: bar selebar layar di bawah, dua baris (petunjuk | mode + aksi), target sentuh 40px */
@media (max-width:639px){
.pick-bar{left:0;right:0;bottom:0;transform:none;max-width:none;animation-name:rise;flex-wrap:wrap;gap:10px;padding:12px 12px calc(12px + env(safe-area-inset-bottom));border-radius:18px 18px 0 0;white-space:normal}
.pick-hint{flex:1 0 100%;text-align:center;padding:0;font-size:14px}
.seg{margin-right:auto}
.seg button{height:36px;padding:0 16px;border-radius:18px}
.pick-bar .pill{height:40px;padding:0 18px;border-radius:20px;font-size:14px}
}
@media (prefers-reduced-motion:reduce){.pick-box.hover{transition:none}.pick-bar{animation:none}}

/* Anotasi (layar penuh) */
.annot{position:fixed;inset:0;z-index:2147483647;background:#0d0d0d;display:flex;flex-direction:column;color:#fafafa}
.annot .headerbar{grid-template-columns:auto 1fr auto;padding:calc(8px + env(safe-area-inset-top)) 10px 8px}
.annot .headerbar .end{display:flex;gap:6px}
.annot .pillbtn{height:34px;padding:0 14px;border-radius:17px;border:0;background:rgba(255,255,255,.12);color:#fafafa;font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px}
.annot .pillbtn.sugg{background:#fafafa;color:#0d0d0d}
.annot .circ{width:34px;height:34px;border-radius:17px;color:#fafafa;background:rgba(255,255,255,.12)}
.annot .stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:8px}
.annot canvas{max-width:100%;max-height:100%;touch-action:none;border-radius:10px;background:#fff}
.annot .foot{text-align:center;font-size:12px;color:rgba(255,255,255,.6);padding:4px 0 calc(12px + env(safe-area-inset-bottom))}
`;
