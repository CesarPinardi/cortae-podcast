'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, CircleDot, Clock3,
  Download, Headphones, Info, Link2, LoaderCircle, Pause, Play, Radio, RotateCcw,
  Scissors, Sparkles, UploadCloud, Volume2, WandSparkles, X,
} from 'lucide-react';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';

type Screen = 'home' | 'loading' | 'editor' | 'exporting' | 'ready';

const DURATION = 5554;
const FALLBACK_TITLE = 'Episódio importado';
const bars = Array.from({ length: 132 }, (_, i) => 16 + ((i * 31 + i * i * 7) % 72));
const steps = [
  { Icon: Clock3, number: '01', title: 'Importe', copy: 'Cole o link assim que a transmissão acabar.' },
  { Icon: CircleDot, number: '02', title: 'Faça o corte', copy: 'Marque onde o programa realmente começa e termina.' },
  { Icon: Headphones, number: '03', title: 'Baixe o áudio', copy: 'Arquivo nivelado e pronto para os agregadores.' },
];

function formatTime(total: number) {
  const seconds = Math.max(0, Math.round(total));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(hours ? 2 : 1, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function parseTime(value: string, fallback: number) {
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN) || parts.length < 2 || parts.length > 3) return fallback;
  const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  return Math.max(0, Math.min(DURATION, seconds));
}

function fileNameFromTitle(title: string) {
  const fileName = title
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();

  return fileName || FALLBACK_TITLE;
}

async function getYoutubeTitle(url: string) {
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('format', 'json');

  const response = await fetch(endpoint);
  if (!response.ok) throw new Error('YouTube metadata request failed.');

  const metadata: unknown = await response.json();
  if (!metadata || typeof metadata !== 'object' || !('title' in metadata) || typeof metadata.title !== 'string' || !metadata.title.trim()) {
    throw new Error('YouTube metadata did not include a title.');
  }

  return metadata.title.trim();
}

function TimeField({
  label,
  ariaLabel,
  seconds,
  onCommit,
}: {
  label: string;
  ariaLabel: string;
  seconds: number;
  onCommit: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState(formatTime(seconds));

  useEffect(() => {
    setDraft(formatTime(seconds));
  }, [seconds]);

  function commit() {
    const next = parseTime(draft, seconds);
    setDraft(formatTime(next));
    onCommit(next);
  }

  return (
    <label className="time-field">
      <span>{label}</span>
      <Input
        aria-label={ariaLabel}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        value={draft}
      />
    </label>
  );
}

function Header({ compact = false, onHome }: { compact?: boolean; onHome?: () => void }) {
  return (
    <header className="mx-auto flex h-20 max-w-[1480px] items-center justify-between px-5 md:px-10">
      <button className="flex items-center gap-3" onClick={onHome} aria-label="Cortaê, início">
        <span className="brand-mark"><Radio className="size-5" strokeWidth={2.4} /></span>
        <span className="text-lg font-black tracking-[-0.04em]">CORTAÊ</span>
      </button>
      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-2 text-xs font-semibold text-muted-foreground sm:flex">
          <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgb(52_211_153/12%)]" />
          {compact ? 'Rascunho salvo' : 'Sistema online'}
        </span>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">Demonstração</span>
      </div>
    </header>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('home');
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [trim, setTrim] = useState([73, 5458]);
  const [position, setPosition] = useState(73);
  const [playing, setPlaying] = useState(false);
  const [confirmUncut, setConfirmUncut] = useState(false);
  const [progress, setProgress] = useState(0);
  const [episodeTitle, setEpisodeTitle] = useState(FALLBACK_TITLE);
  const [fileName, setFileName] = useState(FALLBACK_TITLE);
  const [format, setFormat] = useState('MP3 · 128 kbps');

  useEffect(() => {
    if (!playing || position >= trim[1]) return;
    const timer = window.setInterval(() => setPosition((current) => Math.min(trim[1], current + 5)), 250);
    return () => window.clearInterval(timer);
  }, [playing, position, trim]);

  useEffect(() => {
    if (screen !== 'exporting') return;
    setProgress(8);
    const timer = window.setInterval(() => setProgress((current) => {
      if (current >= 100) {
        window.clearInterval(timer);
        window.setTimeout(() => setScreen('ready'), 350);
        return 100;
      }
      return Math.min(100, current + 7);
    }), 180);
    return () => window.clearInterval(timer);
  }, [screen]);

  const cutDuration = trim[1] - trim[0];
  const startPercent = (trim[0] / DURATION) * 100;
  const endPercent = (trim[1] / DURATION) * 100;
  const positionPercent = (position / DURATION) * 100;
  const fileSize = useMemo(() => Math.max(1, Math.round(cutDuration * 0.016)), [cutDuration]);

  async function importEpisode(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const youtubeUrl = url.trim();
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(youtubeUrl)) {
      setUrlError('Cole um link válido do YouTube.');
      return;
    }
    setUrlError('');
    setScreen('loading');

    const [title] = await Promise.all([
      getYoutubeTitle(youtubeUrl).catch(() => FALLBACK_TITLE),
      new Promise((resolve) => window.setTimeout(resolve, 1700)),
    ]);

    setEpisodeTitle(title);
    setFileName(fileNameFromTitle(title));
    setScreen('editor');
  }

  function beginExport() {
    if (trim[0] === 0) {
      setConfirmUncut(true);
      return;
    }
    setScreen('exporting');
  }

  function goHome() {
    setPlaying(false);
    setScreen('home');
  }

  if (screen === 'home') {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <Header />
        <section className="mx-auto grid max-w-[1480px] gap-8 px-5 pb-12 pt-8 md:px-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(380px,.88fr)] lg:items-end lg:pb-20 lg:pt-16">
          <div className="max-w-4xl">
            <div className="eyebrow"><Sparkles className="size-3.5" /> DA LIVE PRO FEED</div>
            <h1 className="mt-6 text-[clamp(3.4rem,8vw,7.6rem)] font-black leading-[.85] tracking-[-0.07em]">Terminou a live.<br /><span className="text-primary">O podcast já vai.</span></h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">Cole o link do YouTube, corte a contagem regressiva e receba o áudio pronto para publicar — enquanto o assunto ainda está quente.</p>
          </div>
          <form onSubmit={importEpisode} className="import-card" noValidate>
            <div className="mb-7 flex items-start justify-between gap-5">
              <div><p className="text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">Novo episódio</p><h2 className="mt-2 text-2xl font-bold tracking-tight">Cole o link da live</h2></div>
              <span className="step-chip">01</span>
            </div>
            <label className="mb-2 block text-sm font-semibold" htmlFor="youtube-url">URL do YouTube</label>
            <div className="relative">
              <Link2 className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input id="youtube-url" aria-invalid={Boolean(urlError)} className="h-14 rounded-xl border-border bg-secondary/70 pl-11 pr-4 text-[15px] shadow-none focus-visible:ring-primary/30" onChange={(event) => { setUrl(event.target.value); setUrlError(''); }} placeholder="youtube.com/watch?v=..." type="url" value={url} />
            </div>
            {urlError && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive"><X className="size-3.5" />{urlError}</p>}
            <Button className="mt-4 h-14 w-full rounded-xl text-base font-bold" disabled={!url.trim()} type="submit">Importar live <ArrowRight className="size-4" /></Button>
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Check className="size-3.5 text-primary" /> Título, duração e capa vêm automaticamente.</p>
          </form>
        </section>
        <section className="border-y border-border bg-card/55">
          <div className="mx-auto grid max-w-[1480px] gap-px bg-border px-5 md:grid-cols-3 md:px-10">
            {steps.map(({ Icon, number, title, copy }) => (
              <article className="bg-background px-1 py-7 md:px-7" key={number}><div className="flex items-center justify-between"><Icon className="size-5 text-primary" /><span className="font-mono text-xs text-muted-foreground">/{number}</span></div><h3 className="mt-6 text-lg font-bold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{copy}</p></article>
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (screen === 'loading') {
    return (
      <main className="min-h-screen"><Header compact onHome={goHome} /><div className="mx-auto grid min-h-[calc(100vh-80px)] max-w-xl place-items-center px-5 pb-24 text-center"><div className="w-full"><span className="mx-auto grid size-20 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary"><LoaderCircle className="size-9 animate-spin" /></span><p className="mt-8 text-xs font-bold uppercase tracking-[.16em] text-primary">Importando do YouTube</p><h1 className="mt-3 text-3xl font-bold tracking-tight">Preparando a timeline…</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Buscando o vídeo e analisando a faixa de áudio.</p><div className="mx-auto mt-8 max-w-sm overflow-hidden rounded-full bg-secondary"><div className="loading-bar h-1.5 rounded-full bg-primary" /></div></div></div></main>
    );
  }

  if (screen === 'exporting') {
    return (
      <main className="min-h-screen"><Header compact onHome={goHome} /><div className="mx-auto grid min-h-[calc(100vh-80px)] max-w-xl place-items-center px-5 pb-24 text-center"><div className="w-full"><span className="mx-auto grid size-20 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary"><WandSparkles className="size-9 animate-pulse" /></span><p className="mt-8 text-xs font-bold uppercase tracking-[.16em] text-primary">Gerando episódio</p><h1 className="mt-3 text-3xl font-bold tracking-tight">Deixando o áudio redondo.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">Aplicando cortes, normalização e metadados.</p><Progress className="mx-auto mt-8 max-w-sm" value={progress} /><p className="mt-3 font-mono text-xs text-muted-foreground">{progress}% concluído</p></div></div></main>
    );
  }

  if (screen === 'ready') {
    return (
      <main className="min-h-screen"><Header compact onHome={goHome} /><div className="mx-auto grid min-h-[calc(100vh-80px)] max-w-2xl place-items-center px-5 pb-20"><section className="w-full rounded-3xl border border-border bg-card p-6 text-center shadow-2xl md:p-10"><span className="mx-auto grid size-20 place-items-center rounded-full bg-primary text-primary-foreground"><CheckCircle2 className="size-10" /></span><p className="mt-7 text-xs font-bold uppercase tracking-[.16em] text-primary">Tudo pronto</p><h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Episódio pronto para o feed.</h1><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">O áudio foi cortado e configurado. No produto final, o arquivo seria gerado pelo servidor.</p><div className="mx-auto mt-8 flex max-w-md items-center gap-4 rounded-2xl border border-border bg-background p-4 text-left"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Headphones className="size-5" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{fileName}.mp3</p><p className="mt-1 text-xs text-muted-foreground">{format} · aprox. {fileSize} MB</p></div><Check className="size-4 text-primary" /></div><Button className="mt-5 h-12 w-full max-w-md rounded-xl font-bold" onClick={() => alert('Demonstração concluída. A geração real entra na etapa de backend.')}><Download className="size-4" /> Baixar áudio</Button><div className="mx-auto mt-7 max-w-md rounded-2xl border border-dashed border-border p-4 text-left"><p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><UploadCloud className="size-4" /> Publicar nos agregadores <span className="ml-auto rounded-md bg-secondary px-2 py-1 text-[10px] font-bold uppercase tracking-wider">TODO</span></p></div><button className="mt-7 text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={goHome}>Converter outro episódio</button></section></div></main>
    );
  }

  return (
    <main className="min-h-screen">
      <Header compact onHome={goHome} />
      <div className="mx-auto max-w-[1320px] px-5 pb-12 md:px-10">
        <button className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground" onClick={goHome}><ArrowLeft className="size-4" /> Trocar vídeo</button>
        <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div><div className="eyebrow"><Scissors className="size-3.5" /> CORTE DO EPISÓDIO</div><h1 className="mt-4 max-w-3xl text-3xl font-black tracking-[-.04em] md:text-5xl">{episodeTitle}</h1><p className="mt-3 text-sm text-muted-foreground">Ao vivo · 02 set 2026 · Duração original {formatTime(DURATION)}</p></div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold"><span className="size-2 rounded-full bg-primary" /> Live importada</div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
          <section className="rounded-3xl border border-border bg-card p-5 md:p-8">
            <div className="flex items-center justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">Timeline</p><h2 className="mt-1 text-xl font-bold">Onde o programa começa?</h2></div><Button className="rounded-full" onClick={() => { setTrim([73, 5458]); setPosition(73); }} size="sm" variant="ghost"><RotateCcw className="size-3.5" /> Restaurar</Button></div>

            <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-background p-4 md:p-6">
              <div className="relative h-44">
                <div className="absolute inset-x-0 top-5 flex h-28 items-center gap-[3px] overflow-hidden" aria-hidden="true">
                  {bars.map((height, index) => <span className="min-w-[2px] flex-1 rounded-full bg-primary/65" key={index} style={{ height: `${height}%`, opacity: index / bars.length * 100 < startPercent || index / bars.length * 100 > endPercent ? .16 : .9 }} />)}
                </div>
                <div className="absolute bottom-0 left-0 right-0 px-1"><Slider aria-label="Selecionar início e fim do episódio" min={0} max={DURATION} step={1} value={trim} onValueChange={(value) => { const next = value as number[]; setTrim(next); setPosition(Math.max(next[0], Math.min(position, next[1]))); }} /></div>
                <div className="pointer-events-none absolute top-3 h-32 w-px bg-white/80" style={{ left: `${positionPercent}%` }}><span className="absolute -left-1.5 -top-1 size-3 rounded-full border-2 border-background bg-white" /></div>
                <span className="absolute bottom-5 font-mono text-[10px] text-muted-foreground" style={{ left: `${startPercent}%`, transform: 'translateX(-4px)' }}>{formatTime(trim[0])}</span>
                <span className="absolute bottom-5 font-mono text-[10px] text-muted-foreground" style={{ left: `${endPercent}%`, transform: 'translateX(-100%)' }}>{formatTime(trim[1])}</span>
              </div>
              <div className="mt-4 flex items-center gap-4 border-t border-border pt-4"><Button aria-label={playing ? 'Pausar' : 'Reproduzir'} className="size-11 rounded-full" onClick={() => setPlaying(!playing)} size="icon">{playing ? <Pause /> : <Play className="ml-0.5" />}</Button><div className="font-mono text-sm"><span className="text-foreground">{formatTime(position)}</span><span className="text-muted-foreground"> / {formatTime(DURATION)}</span></div><Volume2 className="ml-auto size-4 text-muted-foreground" /></div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <TimeField
                label="Começa em"
                ariaLabel="Tempo de início"
                seconds={trim[0]}
                onCommit={(seconds) => {
                  const start = Math.min(seconds, trim[1] - 1);
                  setTrim([start, trim[1]]);
                  setPosition(start);
                }}
              />
              <TimeField
                label="Termina em"
                ariaLabel="Tempo final"
                seconds={trim[1]}
                onCommit={(seconds) => setTrim([trim[0], Math.max(trim[0] + 1, seconds)])}
              />
            </div>
            <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/[.06] p-4 text-sm sm:flex-row sm:items-center"><Info className="size-4 shrink-0 text-primary" /><p className="text-muted-foreground"><strong className="text-foreground">Corte atual:</strong> {formatTime(trim[0])} no início e {formatTime(DURATION - trim[1])} no final.</p><span className="sm:ml-auto whitespace-nowrap font-mono text-xs text-primary">{formatTime(cutDuration)} finais</span></div>
          </section>

          <aside className="rounded-3xl border border-border bg-card p-5 md:p-6">
            <p className="text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">Saída do arquivo</p><h2 className="mt-2 text-xl font-bold">Detalhes do episódio</h2>
            <label className="mt-7 block text-sm font-semibold" htmlFor="filename">Nome do arquivo</label><div className="mt-2 flex items-center rounded-xl border border-border bg-background pr-3 focus-within:ring-2 focus-within:ring-primary/30"><Input id="filename" className="h-12 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0" value={fileName} onChange={(event) => setFileName(event.target.value)} /><span className="text-xs text-muted-foreground">.mp3</span></div>
            <label className="mt-5 block text-sm font-semibold" htmlFor="format">Formato</label><select id="format" className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" value={format} onChange={(event) => setFormat(event.target.value)}><option>MP3 · 128 kbps</option><option>MP3 · 192 kbps</option><option>AAC · 128 kbps</option></select>
            <div className="my-6 h-px bg-border" />
            <div className="space-y-3 text-sm"><p className="flex justify-between text-muted-foreground"><span>Duração</span><strong className="font-mono text-foreground">{formatTime(cutDuration)}</strong></p><p className="flex justify-between text-muted-foreground"><span>Tamanho estimado</span><strong className="text-foreground">~{fileSize} MB</strong></p><p className="flex justify-between text-muted-foreground"><span>Normalização</span><strong className="text-foreground">-16 LUFS</strong></p></div>
            <Button className="mt-7 h-13 w-full rounded-xl text-sm font-bold" onClick={beginExport}>Gerar áudio <ChevronRight className="size-4" /></Button>
            <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">A publicação automática nos agregadores entra na próxima etapa.</p>
          </aside>
        </div>
      </div>

      <AlertDialog open={confirmUncut} onOpenChange={setConfirmUncut}>
        <AlertDialogContent className="border-border bg-card p-6 sm:max-w-md">
          <AlertDialogHeader><AlertDialogMedia className="bg-amber-400/10 text-amber-300"><Scissors /></AlertDialogMedia><AlertDialogTitle>O início não foi cortado</AlertDialogTitle><AlertDialogDescription>A contagem regressiva pode ir junto para o podcast. Deseja gerar o áudio mesmo assim?</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter className="mt-2 border-border bg-secondary/40"><AlertDialogCancel onClick={() => setConfirmUncut(false)}>Voltar e cortar</AlertDialogCancel><AlertDialogAction onClick={() => { setConfirmUncut(false); setScreen('exporting'); }}>Gerar sem cortar</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
