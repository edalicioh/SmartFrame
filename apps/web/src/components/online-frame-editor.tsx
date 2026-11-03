"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultOnlineDashboard, onlineDashboardSchema, type OnlineDashboard, type OnlineDashboardState } from "@smartframe/contracts";

type Device = { id: string; name: string; lastSeenAt: string | null; appliedRevision: string | null };
type Photo = { id: string; filename: string; status: string; width?: number | null; height?: number | null };

async function api(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir a operação.");
  return data;
}

export function OnlineFrameEditor() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [state, setState] = useState<OnlineDashboardState | null>(null);
  const [config, setConfig] = useState<OnlineDashboard>(defaultOnlineDashboard);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pairing, setPairing] = useState<{code:string;expiresAt:string}|null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const readyPhotos = useMemo(() => photos.filter(p => p.status === "ready"), [photos]);
  const previewConfig = useMemo(() => ({ ...config, widgets: { ...config.widgets, photos: { ...config.widgets.photos, items: readyPhotos.filter(p => config.widgets.photos.photoIds.includes(p.id)).map(p => ({ id:p.id, src:`/api/photos/${p.id}/image`, alt:p.filename })) } } }), [config, readyPhotos]);
  const sendPreview = useCallback(() => {
    frame.current?.contentWindow?.postMessage({ type:"smartframe:online-preview", config:previewConfig }, window.location.origin);
  }, [previewConfig]);
  useEffect(() => { sendPreview(); }, [sendPreview]);

  useEffect(() => {
    let active = true;
    api("/api/devices").then(result => { if (active) setDevices(result.data ?? []); }).catch(e => { if(active)setError(e.message); });
    api("/api/photos").then(result => { if(active)setPhotos(result.photos ?? []); }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!deviceId) { setState(null); return; }
    let active = true;
    if (dirty && !window.confirm("Há alterações não salvas. Descartar para trocar de dispositivo?")) {
      const previous = devices.find(d => d.id === state?.deviceId);
      setDeviceId(previous?.id ?? ""); return;
    }
    setBusy("Carregando dispositivo…"); setError(""); setDirty(false);
    api(`/api/online-frame?deviceId=${encodeURIComponent(deviceId)}`).then((next:OnlineDashboardState) => {
      if(active) { setState(next); setConfig(next.config); }
    }).catch(e => { if(active)setError(e.message); }).finally(() => { if(active)setBusy(""); });
    return () => { active = false; };
  // device change deliberately gates dirty state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(() => {
    const pending = photos.some(p => p.status === "pending" || p.status === "processing");
    if (!pending) return;
    let active = true;
    const timer = window.setInterval(() => api("/api/photos").then(r => { if(active)setPhotos(r.photos ?? []); }).catch(() => {}), 2500);
    const stop = window.setTimeout(() => window.clearInterval(timer), 90000);
    return () => { active = false; window.clearInterval(timer); window.clearTimeout(stop); };
  }, [photos]);

  function change(next: OnlineDashboard) { setConfig(next); setDirty(true); setNotice(""); }
  async function save(publish:boolean) {
    if (!state || !deviceId) return;
    const parsed = onlineDashboardSchema.safeParse(config);
    if(!parsed.success) { setError("Confira as configurações antes de salvar."); return; }
    setBusy(publish ? "Publicando…" : "Salvando…"); setError(""); setNotice("");
    try {
      let revision = state.draftRevision;
      if(dirty || revision === 0) {
        const result = await api("/api/online-frame", { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify({deviceId,config:parsed.data,expectedRevision:revision}) });
        revision = result.draftRevision;
      }
      let publishedRevision = state.publishedRevision;
      if(publish) {
        const result = await api("/api/online-frame/publish", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({deviceId,expectedRevision:revision}) });
        publishedRevision = result.revision;
      }
      setState({...state,config:parsed.data,draftRevision:revision,publishedRevision}); setDirty(false);
      setNotice(publish ? "Publicado. Aguardando confirmação de aplicação pelo dispositivo." : "Rascunho salvo; o dispositivo não foi alterado.");
    } catch(e) { setError(e instanceof Error ? e.message : "Falha ao salvar."); }
    finally { setBusy(""); }
  }
  async function upload(files:FileList|null) {
    if(!files)return;
    setBusy("Enviando fotos…"); setError("");
    try {
      for(const file of Array.from(files)) {
        if(file.size > 12*1024**2) throw new Error(`${file.name}: escolha uma imagem de até 12 MB.`);
        const form = new FormData(); form.set("photo",file);
        const added = await api("/api/photos",{method:"POST",body:form});
        setPhotos(current => [{...added},...current.filter(p=>p.id!==added.id)]);
        if(added.status === "ready") setConfig(current => ({...current,widgets:{...current.widgets,photos:{...current.widgets.photos,photoIds:[...current.widgets.photos.photoIds,added.id]}}}));
        setDirty(true);
      }
      setNotice("Fotos enviadas. As que estão sendo processadas serão selecionáveis quando prontas.");
    } catch(e) { setError(e instanceof Error ? e.message : "Falha ao enviar fotos."); }
    finally { setBusy(""); }
  }
  async function pair() { setBusy("Gerando código…"); try { setPairing(await api("/api/devices/pairing-code",{method:"POST"})); } catch(e){setError(e instanceof Error?e.message:"Falha ao gerar código.");} finally{setBusy("");} }
  async function revoke(device:Device) { if(!window.confirm(`Desvincular ${device.name}?`))return; try {await api(`/api/devices/${device.id}`,{method:"DELETE"});setDevices(d=>d.filter(x=>x.id!==device.id));if(device.id===deviceId){setDeviceId("");setState(null);}}catch(e){setError(e instanceof Error?e.message:"Falha ao desvincular.");} }
  const widget = (key:keyof OnlineDashboard["widgets"], enabled:boolean) => change({...config,widgets:{...config.widgets,[key]:{...config.widgets[key],enabled}}});
  const movePhoto = (index:number,delta:number) => { const ids=[...config.widgets.photos.photoIds]; const target=index+delta; if(target<0||target>=ids.length)return; [ids[index],ids[target]]=[ids[target],ids[index]]; change({...config,widgets:{...config.widgets,photos:{...config.widgets.photos,photoIds:ids}}}); };

  return <main className="online-editor">
    <div className="online-title"><div><p className="online-eyebrow">SMARTFRAME ONLINE</p><h1>Editor do painel</h1><p>Configure, visualize e publique o conteúdo do seu dispositivo.</p></div><label>Dispositivo<select value={deviceId} onChange={e=>setDeviceId(e.target.value)}><option value="">Selecione um dispositivo</option>{devices.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label></div>
    {!devices.length && <div className="online-callout">Nenhum dispositivo vinculado. Gere um código e vincule o SmartFrame para começar.<button onClick={pair} disabled={!!busy}>Vincular dispositivo</button></div>}
    {pairing && <div className="online-callout">Código de vinculação <strong>{pairing.code}</strong> · expira {new Date(pairing.expiresAt).toLocaleTimeString("pt-BR")}<button onClick={()=>setPairing(null)}>Fechar</button></div>}
    {devices.length>0 && <div className="online-device-actions"><button onClick={pair} disabled={!!busy}>Gerar código para novo dispositivo</button>{deviceId&&<button className="online-danger" onClick={()=>{const d=devices.find(x=>x.id===deviceId);if(d)void revoke(d);}}>Desvincular selecionado</button>}</div>}
    {error&&<div className="online-error" role="alert">{error}</div>}{notice&&<div className="online-notice">{notice}</div>}
    {!deviceId ? <p className="online-empty">Selecione um dispositivo para editar seu painel.</p> : <div className="online-grid"><section className="online-controls">
      {busy&&<p className="online-busy">{busy}</p>}
      <fieldset><legend>Fotos</legend><label className="online-upload">Adicionar várias fotos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>void upload(e.target.files)} /></label><div className="online-photo-list">{photos.map(p=><div className="online-photo" key={p.id}><label><input type="checkbox" disabled={p.status!=="ready"} checked={config.widgets.photos.photoIds.includes(p.id)} onChange={e=>{const ids=e.target.checked?[...config.widgets.photos.photoIds,p.id]:config.widgets.photos.photoIds.filter(id=>id!==p.id);change({...config,widgets:{...config.widgets,photos:{...config.widgets.photos,photoIds:ids}}});}}/>{p.filename} <small>{p.status==="ready"?`${p.width??""}×${p.height??""}`:`${p.status} — indisponível até concluir`}</small></label>{config.widgets.photos.photoIds.includes(p.id)&&<span><button onClick={()=>movePhoto(config.widgets.photos.photoIds.indexOf(p.id),-1)} aria-label="Mover foto para cima">↑</button><button onClick={()=>movePhoto(config.widgets.photos.photoIds.indexOf(p.id),1)} aria-label="Mover foto para baixo">↓</button></span>}</div>)}</div><label>Troca de foto (segundos)<input type="number" min="5" max="3600" value={config.widgets.photos.intervalSeconds} onChange={e=>change({...config,widgets:{...config.widgets,photos:{...config.widgets.photos,intervalSeconds:Number(e.target.value)}}})}/></label><label>Ajuste da imagem<select value={config.widgets.photos.fit} onChange={e=>change({...config,widgets:{...config.widgets,photos:{...config.widgets.photos,fit:e.target.value as "cover"|"contain"}}})}><option value="cover">Preencher</option><option value="contain">Conter</option></select></label></fieldset>
      <fieldset><legend>Widgets</legend>{([ ["clock","Relógio"],["weather","Clima"],["currencies","Moedas"],["calendar","Calendário"] ] as const).map(([key,label])=><label className="online-toggle" key={key}><input type="checkbox" checked={config.widgets[key].enabled} onChange={e=>widget(key,e.target.checked)}/>{label}</label>)}<label className="online-toggle"><input type="checkbox" checked={config.widgets.photos.enabled} onChange={e=>widget("photos",e.target.checked)}/>Fotos</label><label>Formato do relógio<select value={config.widgets.clock.format} onChange={e=>change({...config,widgets:{...config.widgets,clock:{...config.widgets.clock,format:e.target.value as "12h"|"24h"}}})}><option value="24h">24 horas</option><option value="12h">12 horas</option></select></label><label>Tamanho do relógio<select value={config.widgets.clock.size} onChange={e=>change({...config,widgets:{...config.widgets,clock:{...config.widgets.clock,size:e.target.value as "small"|"normal"|"large"}}})}><option value="small">Pequeno</option><option value="normal">Normal</option><option value="large">Grande</option></select></label><label className="online-toggle"><input type="checkbox" checked={config.widgets.clock.showDate} onChange={e=>change({...config,widgets:{...config.widgets,clock:{...config.widgets.clock,showDate:e.target.checked}}})}/>Mostrar data</label><label>Cidade do clima<input value={config.widgets.weather.city} maxLength={80} onChange={e=>change({...config,widgets:{...config.widgets,weather:{...config.widgets.weather,city:e.target.value}}})}/></label></fieldset>
      <fieldset><legend>Aparência e layout</legend><label>Tema<select value={config.theme} onChange={e=>change({...config,theme:e.target.value as "light"|"dark"})}><option value="light">Claro</option><option value="dark">Escuro</option></select></label>{([ ["backgroundColor","Fundo"],["accentColor","Destaque"],["textColor","Texto"] ] as const).map(([key,label])=><label key={key}>{label}<input type="color" value={config.appearance[key]} onChange={e=>change({...config,appearance:{...config.appearance,[key]:e.target.value}})}/></label>)}<label>Orientação<select value={config.orientation} onChange={e=>change({...config,orientation:e.target.value as "landscape"|"portrait"})}><option value="landscape">Paisagem</option><option value="portrait">Retrato</option></select></label><label>Proporção da foto · {config.layoutOptions.photoWidthPercent}%<input type="range" min="40" max="75" value={config.layoutOptions.photoWidthPercent} onChange={e=>change({...config,layoutOptions:{...config.layoutOptions,photoWidthPercent:Number(e.target.value)}})}/></label><label>Posição da foto<select value={config.layoutOptions.photoPosition} onChange={e=>change({...config,layoutOptions:{...config.layoutOptions,photoPosition:e.target.value as "left"|"right"}})}><option value="left">Esquerda</option><option value="right">Direita</option></select></label><label>Atualização geral (segundos)<input type="number" min="10" max="3600" value={config.refreshSeconds} onChange={e=>change({...config,refreshSeconds:Number(e.target.value)})}/></label><label>Fuso horário<input value={config.timezone} onChange={e=>change({...config,timezone:e.target.value})}/></label></fieldset>
      <div className="online-save"><button disabled={!!busy||!state} onClick={()=>void save(false)}>Salvar rascunho</button><button disabled={!!busy||!state||!config.widgets.photos.photoIds.every(id=>readyPhotos.some(p=>p.id===id))} onClick={()=>void save(true)}>Publicar</button>{dirty&&<small>Alterações não salvas</small>}</div>
    </section><section className="online-preview"><header><strong>Prévia ao vivo</strong><span>{state?.publishedRevision?`Publicado ${state.publishedRevision}`:"Ainda não publicado"}</span></header><iframe ref={frame} onLoad={sendPreview} src="/player-dashboard/index.html?preview=1" title="Prévia do painel"/><p>Rascunho r{state?.draftRevision??"—"} · Publicado {state?.publishedRevision??"—"} · Aplicado pelo dispositivo {state?.appliedRevision??"—"}</p>{state?.lastSeenAt&&<small>Visto por último: {new Date(state.lastSeenAt).toLocaleString("pt-BR")}</small>}{state?.publishedRevision&&!state.appliedRevision?.includes(state.publishedRevision)&&<p>Publicação enviada; aguardando confirmação do dispositivo conectado.</p>}</section></div>}
  </main>;
}
