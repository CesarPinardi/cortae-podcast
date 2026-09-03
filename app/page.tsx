'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileAudio,
  FileText,
  Globe2,
  Headphones,
  Info,
  Link2,
  LoaderCircle,
  Pause,
  Play,
  Podcast,
  Radio,
  RotateCcw,
  Save,
  Scissors,
  Settings2,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Volume2,
  WandSparkles,
  X,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import {
  createEpisode,
  DEFAULT_DESTINATIONS,
  DEFAULT_PROGRAM,
  Destination,
  DestinationStatus,
  Episode,
  EpisodeKind,
  EpisodeStatus,
  feedUrl,
  formatBytes,
  formatDuration,
  Program,
  slugify,
  validateEpisode,
} from '@/lib/podcast';

type Screen = 'home' | 'loading' | 'editor' | 'exporting' | 'ready';
type Notice = { tone: 'success' | 'error' | 'info'; text: string } | null;

const DURATION = 5554;
const FALLBACK_TITLE = 'Episódio importado';
const STORAGE_KEY = 'cortae-podcast-studio-v1';
const bars = Array.from(
  { length: 132 },
  (_, i) => 16 + ((i * 31 + i * i * 7) % 72),
);
const steps = [
  {
    Icon: Clock3,
    number: '01',
    title: 'Importe',
    copy: 'Cole o link assim que a transmissão acabar.',
  },
  {
    Icon: CircleDot,
    number: '02',
    title: 'Faça o corte',
    copy: 'Marque onde o programa realmente começa e termina.',
  },
  {
    Icon: Headphones,
    number: '03',
    title: 'Publique',
    copy: 'Um feed RSS para distribuir em todos os agregadores.',
  },
];
const platformData = {
  spotify: {
    name: 'Spotify',
    short: 'SP',
    description: 'Spotify for Creators',
    url: 'https://creators.spotify.com/',
    instructions: 'Adicione o feed RSS e confirme o e-mail público.',
  },
  apple: {
    name: 'Apple Podcasts',
    short: 'AP',
    description: 'Apple Podcasts Connect',
    url: 'https://podcastsconnect.apple.com/',
    instructions: 'Valide o feed e envie para revisão do catálogo.',
  },
  amazon: {
    name: 'Amazon Music',
    short: 'AM',
    description: 'Amazon Music for Podcasters',
    url: 'https://podcasters.amazon.com/',
    instructions: 'Cole a URL do feed para reivindicar o programa.',
  },
  youtube: {
    name: 'YouTube Music',
    short: 'YM',
    description: 'YouTube Studio',
    url: 'https://studio.youtube.com/',
    instructions: 'Use a importação por RSS disponível para sua região.',
  },
} as const;

function formatTime(total: number) {
  return formatDuration(total);
}

function parseTime(value: string, fallback: number) {
  const parts = value.split(':').map(Number);
  if (parts.some(Number.isNaN) || parts.length < 2 || parts.length > 3)
    return fallback;
  const seconds =
    parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts[0] * 60 + parts[1];
  return Math.max(0, Math.min(DURATION, seconds));
}

function dateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

function localDateTimeToIso(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return '';
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let index = 0; index < 3; index += 1) {
    const current = dateTimeParts(new Date(guess), timeZone);
    const rendered = Date.UTC(
      Number(current.year),
      Number(current.month) - 1,
      Number(current.day),
      Number(current.hour),
      Number(current.minute),
    );
    guess += Date.UTC(year, month - 1, day, hour, minute) - rendered;
  }
  return new Date(guess).toISOString();
}

function isoToLocalDateTime(value: string, timeZone: string) {
  if (!value) return '';
  const parts = dateTimeParts(new Date(value), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function fileNameFromTitle(title: string) {
  const fileName = title
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return fileName || FALLBACK_TITLE;
}

function createDemoAudioFile() {
  const sampleRate = 8000;
  const seconds = 1;
  const dataSize = sampleRate * seconds * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataSize, true);
  return new File([buffer], 'episodio-cortae.wav', { type: 'audio/wav' });
}

async function createDefaultCoverFile() {
  const canvas = document.createElement('canvas');
  canvas.width = 1400;
  canvas.height = 1400;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível preparar a capa.');
  context.fillStyle = '#101313';
  context.fillRect(0, 0, 1400, 1400);
  context.fillStyle = '#d4f34a';
  context.fillRect(100, 100, 1200, 1200);
  context.fillStyle = '#101313';
  context.font = '900 190px sans-serif';
  context.fillText('CORTAÊ', 170, 720);
  context.font = '700 62px sans-serif';
  context.fillText('PODCAST', 180, 830);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error('Não foi possível preparar a capa.')),
      'image/jpeg',
      0.92,
    ),
  );
  return new File([blob], 'capa-cortae.jpg', { type: 'image/jpeg' });
}

async function apiJson<T>(endpoint: string, init?: RequestInit) {
  const response = await fetch(endpoint, init);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'details' in payload &&
      Array.isArray(payload.details)
        ? payload.details[0]
        : payload &&
            typeof payload === 'object' &&
            'error' in payload &&
            typeof payload.error === 'string'
          ? payload.error
          : 'A operação não pôde ser concluída.';
    throw new Error(String(message));
  }
  return payload as T;
}

async function getYoutubeTitle(url: string) {
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('format', 'json');
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error('YouTube metadata request failed.');
  const metadata: unknown = await response.json();
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('title' in metadata) ||
    typeof metadata.title !== 'string' ||
    !metadata.title.trim()
  )
    throw new Error('YouTube metadata did not include a title.');
  return metadata.title.trim();
}

async function coverMatchesPodcastRequirements(file: File) {
  if (typeof createImageBitmap === 'undefined') return false;
  const image = await createImageBitmap(file);
  const valid =
    image.width === image.height && image.width >= 1400 && image.width <= 3000;
  image.close();
  return valid;
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

function Header({
  compact = false,
  onHome,
}: {
  compact?: boolean;
  onHome?: () => void;
}) {
  return (
    <header className="mx-auto flex h-20 max-w-[1480px] items-center justify-between px-5 md:px-10">
      <button
        className="flex items-center gap-3"
        onClick={onHome}
        aria-label="Cortaê, início"
      >
        <span className="brand-mark">
          <Radio className="size-5" strokeWidth={2.4} />
        </span>
        <span className="text-lg font-black tracking-[-.04em]">CORTAÊ</span>
      </button>
      <div className="flex items-center gap-3">
        <span className="hidden items-center gap-2 text-xs font-semibold text-muted-foreground sm:flex">
          <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgb(52_211_153/12%)]" />
          {compact ? 'Rascunho salvo neste dispositivo' : 'Sistema online'}
        </span>
        <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
          Estúdio
        </span>
      </div>
    </header>
  );
}

function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) return null;
  const isError = notice.tone === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={`notice-banner ${isError ? 'notice-error' : notice.tone === 'success' ? 'notice-success' : 'notice-info'}`}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-current/10">
        {isError ? (
          <AlertTriangle className="size-4" />
        ) : notice.tone === 'success' ? (
          <CheckCircle2 className="size-4" />
        ) : (
          <Info className="size-4" />
        )}
      </span>
      <p>{notice.text}</p>
    </div>
  );
}

function StatusPill({ status }: { status: EpisodeStatus }) {
  const labels: Record<EpisodeStatus, string> = {
    draft: 'Rascunho',
    processing: 'Processando',
    ready: 'Pronto para publicar',
    scheduled: 'Agendado',
    published: 'Publicado no feed',
    failed: 'Falhou',
  };
  return (
    <span className={`status-pill status-${status}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {labels[status]}
    </span>
  );
}

function DestinationStatusSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DestinationStatus;
  onChange: (value: DestinationStatus) => void;
}) {
  const labels: Record<DestinationStatus, string> = {
    not_connected: 'Não conectado',
    sent: 'Enviado',
    available: 'Disponível',
    problem: 'Com problema',
  };
  return (
    <select
      aria-label={`Estado no agregador: ${label}`}
      className="status-select"
      value={value}
      onChange={(event) => onChange(event.target.value as DestinationStatus)}
    >
      {Object.entries(labels).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
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
  const [confirmAudioReplace, setConfirmAudioReplace] = useState(false);
  const [progress, setProgress] = useState(0);
  const [episodeTitle, setEpisodeTitle] = useState(FALLBACK_TITLE);
  const [fileName, setFileName] = useState(FALLBACK_TITLE);
  const [format, setFormat] = useState('MP3 · 128 kbps');
  const [program, setProgram] = useState<Program>(DEFAULT_PROGRAM);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [destinations, setDestinations] =
    useState<Record<string, Destination>>(DEFAULT_DESTINATIONS);
  const [notice, setNotice] = useState<Notice>(null);
  const [programOpen, setProgramOpen] = useState(true);
  const [feedOpen, setFeedOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [publishing, setPublishing] = useState(false);

  const cutDuration = trim[1] - trim[0];
  const startPercent = (trim[0] / DURATION) * 100;
  const endPercent = (trim[1] / DURATION) * 100;
  const positionPercent = (position / DURATION) * 100;
  const fileSize = useMemo(
    () => Math.max(1, Math.round(cutDuration * 0.016)),
    [cutDuration],
  );
  const feed = useMemo(
    () =>
      typeof window === 'undefined'
        ? feedUrl(program)
        : new URL(feedUrl(program), window.location.origin).toString(),
    [program],
  );
  const publicEpisodes = episode?.status === 'published' ? 1 : 0;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          program?: Program;
          episode?: Episode;
          destinations?: Record<string, Destination>;
        };
        startTransition(() => {
          if (saved.program)
            setProgram({ ...DEFAULT_PROGRAM, ...saved.program });
          if (saved.episode) {
            setEpisode(saved.episode);
            setScreen('ready');
          }
          if (saved.destinations)
            setDestinations({ ...DEFAULT_DESTINATIONS, ...saved.destinations });
        });
      }
    } catch {
      startTransition(() =>
        setNotice({
          tone: 'info',
          text: 'Não foi possível recuperar o rascunho salvo. Você pode continuar normalmente.',
        }),
      );
    }
    startTransition(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ program, episode, destinations }),
    );
  }, [hydrated, program, episode, destinations]);

  useEffect(() => {
    if (!playing || position >= trim[1]) return;
    const timer = window.setInterval(
      () => setPosition((current) => Math.min(trim[1], current + 5)),
      250,
    );
    return () => window.clearInterval(timer);
  }, [playing, position, trim]);

  useEffect(() => {
    if (screen !== 'exporting') return;
    const startTimer = window.setTimeout(() => setProgress(8), 0);
    const timer = window.setInterval(
      () =>
        setProgress((current) => {
          if (current >= 100) {
            window.clearInterval(timer);
            window.setTimeout(() => {
              const generatedAudio = createDemoAudioFile();
              setEpisode(
                createEpisode(
                  episodeTitle,
                  fileName,
                  cutDuration,
                  generatedAudio.size,
                  generatedAudio.type,
                ),
              );
              setAudioFile(generatedAudio);
              setScreen('ready');
            }, 350);
            return 100;
          }
          return Math.min(100, current + 7);
        }),
      180,
    );
    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(timer);
    };
  }, [cutDuration, episodeTitle, fileName, fileSize, format, screen]);

  useEffect(() => {
    if (!episode || episode.status !== 'scheduled' || !episode.publishAt)
      return;
    const publish = () =>
      setEpisode((current) =>
        current && current.status === 'scheduled'
          ? {
              ...current,
              status: 'published',
              publishedAt: new Date().toISOString(),
            }
          : current,
      );
    const timer = window.setInterval(() => {
      if (new Date(episode.publishAt).getTime() <= Date.now()) publish();
    }, 30_000);
    if (new Date(episode.publishAt).getTime() <= Date.now())
      window.setTimeout(publish, 0);
    return () => window.clearInterval(timer);
  }, [episode]);

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
  function updateEpisode(patch: Partial<Episode>) {
    setEpisode((current) => (current ? { ...current, ...patch } : current));
  }
  async function saveProgram() {
    const form = new FormData();
    form.set('title', program.title);
    form.set('description', program.description);
    form.set('author', program.author);
    form.set('language', program.language);
    form.set('category', program.category);
    form.set('email', program.email);
    form.set('explicit', String(program.explicit));
    form.set('slug', program.slug || slugify(program.title));
    const cover = coverFile ?? (await createDefaultCoverFile());
    if (!coverFile) setCoverFile(cover);
    form.set('cover', cover);
    const saved = await apiJson<{ id: string; slug: string }>('/api/programs', {
      method: 'POST',
      body: form,
    });
    setProgram((current) => ({ ...current, id: saved.id, slug: saved.slug }));
    return saved;
  }

  async function ensureHostedEpisode() {
    if (!episode) throw new Error('Episódio ainda não está pronto.');
    const savedProgram = await saveProgram();
    let hosted = episode;
    if (!hosted.programId) {
      const created = await apiJson<{
        guid: string;
        audioKey: string;
        mediaPath: string;
      }>('/api/episodes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          programId: savedProgram.id,
          sourceUrl: url || 'https://www.youtube.com/',
          title: hosted.title,
          description: hosted.description,
          kind: hosted.kind,
          season: hosted.season,
          number: hosted.number,
          explicit: hosted.explicit,
          timezone: hosted.timezone,
          publishAt: hosted.publishAt,
          audioName: hosted.audioName,
          mimeType: hosted.mimeType,
          sizeBytes: hosted.sizeBytes,
          duration: hosted.duration,
        }),
      });
      hosted = {
        ...hosted,
        guid: created.guid,
        programId: savedProgram.id,
        audioKey: created.audioKey,
        enclosureUrl: created.mediaPath,
      };
    } else {
      await apiJson(`/api/episodes/${hosted.guid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: hosted.title,
          description: hosted.description,
          kind: hosted.kind,
          season: hosted.season,
          number: hosted.number,
          explicit: hosted.explicit,
          timezone: hosted.timezone,
          publishAt: hosted.publishAt,
        }),
      });
    }
    if (audioFile) {
      const uploaded = await apiJson<{
        sizeBytes: number;
        mimeType: string;
        mediaPath: string;
      }>(`/api/episodes/${hosted.guid}/audio`, {
        method: 'POST',
        headers: { 'content-type': audioFile.type },
        body: audioFile,
      });
      hosted = {
        ...hosted,
        sizeBytes: uploaded.sizeBytes,
        mimeType: uploaded.mimeType,
        audioKey: hosted.audioKey,
        enclosureUrl: uploaded.mediaPath,
      };
      setAudioFile(null);
    }
    setEpisode(hosted);
    return hosted;
  }

  async function saveDraft() {
    if (!episode) return;
    setPublishing(true);
    try {
      const hosted = await ensureHostedEpisode();
      await apiJson(`/api/episodes/${hosted.guid}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ publishAt: '', status: 'draft' }),
      });
      setEpisode({ ...hosted, status: 'draft', publishAt: '' });
      setNotice({
        tone: 'success',
        text: 'Rascunho salvo no armazenamento. Ele ainda não aparece no feed público.',
      });
    } catch (caught) {
      setNotice({
        tone: 'error',
        text:
          caught instanceof Error
            ? caught.message
            : 'Não foi possível salvar o rascunho.',
      });
    } finally {
      setPublishing(false);
    }
  }
  async function publishNow() {
    if (!episode) return;
    const errors = validateEpisode(episode, program);
    if (errors.length) {
      setNotice({ tone: 'error', text: errors[0] });
      setProgramOpen(true);
      return;
    }
    setPublishing(true);
    try {
      const hosted = await ensureHostedEpisode();
      const published = await apiJson<{ publishedAt: string }>(
        `/api/episodes/${hosted.guid}/publish`,
        { method: 'POST' },
      );
      setEpisode({
        ...hosted,
        status: 'published',
        publishAt: '',
        publishedAt: published.publishedAt,
      });
      setNotice({
        tone: 'success',
        text: 'Publicado no feed público. A leitura e a revisão dos agregadores acontecem separadamente.',
      });
    } catch (caught) {
      setNotice({
        tone: 'error',
        text:
          caught instanceof Error
            ? caught.message
            : 'Não foi possível publicar o episódio.',
      });
    } finally {
      setPublishing(false);
    }
  }
  async function scheduleEpisode() {
    if (!episode) return;
    if (
      !episode.publishAt ||
      new Date(episode.publishAt).getTime() <= Date.now()
    ) {
      setNotice({
        tone: 'error',
        text: 'Escolha uma data e hora futuras para agendar.',
      });
      return;
    }
    const errors = validateEpisode(
      { ...episode, status: 'scheduled' },
      program,
    );
    if (errors.length) {
      setNotice({ tone: 'error', text: errors[0] });
      setProgramOpen(true);
      return;
    }
    setPublishing(true);
    try {
      const hosted = await ensureHostedEpisode();
      const scheduled = await apiJson<{ status: EpisodeStatus }>(
        `/api/episodes/${hosted.guid}/schedule`,
        { method: 'POST' },
      );
      setEpisode({ ...hosted, status: scheduled.status });
      setNotice({
        tone: 'success',
        text: 'Agendamento salvo no armazenamento. O episódio só entra no feed no horário escolhido.',
      });
    } catch (caught) {
      setNotice({
        tone: 'error',
        text:
          caught instanceof Error
            ? caught.message
            : 'Não foi possível agendar o episódio.',
      });
    } finally {
      setPublishing(false);
    }
  }
  async function cancelSchedule() {
    if (!episode) return;
    try {
      await apiJson(`/api/episodes/${episode.guid}/schedule`, {
        method: 'DELETE',
      });
      setEpisode({ ...episode, status: 'draft', publishAt: '' });
      setNotice({
        tone: 'info',
        text: 'Agendamento cancelado. O episódio voltou para rascunho.',
      });
    } catch (caught) {
      setNotice({
        tone: 'error',
        text:
          caught instanceof Error
            ? caught.message
            : 'Não foi possível cancelar o agendamento.',
      });
    }
  }
  async function copyFeed() {
    try {
      await navigator.clipboard.writeText(feed);
      setNotice({ tone: 'success', text: 'URL do feed copiada.' });
    } catch {
      setNotice({
        tone: 'error',
        text: 'Não foi possível copiar. Selecione a URL manualmente.',
      });
    }
  }
  function openFeedPreview() {
    window.open(feed, '_blank', 'noopener,noreferrer');
  }
  function updateDestination(id: string, patch: Partial<Destination>) {
    setDestinations((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }
  function downloadAudio() {
    setNotice({
      tone: 'info',
      text: 'No modo demonstração, o arquivo final continua disponível para download na etapa de geração.',
    });
  }

  if (screen === 'home')
    return (
      <main className="min-h-screen bg-background text-foreground">
        <Header />
        <section className="mx-auto grid max-w-[1480px] gap-8 px-5 pb-12 pt-8 md:px-10 lg:grid-cols-[minmax(0,1.12fr)_minmax(380px,.88fr)] lg:items-end lg:pb-20 lg:pt-16">
          <div className="max-w-4xl">
            <div className="eyebrow">
              <Sparkles className="size-3.5" /> DA LIVE PRO FEED
            </div>
            <h1 className="mt-6 text-[clamp(3.4rem,8vw,7.6rem)] font-black leading-[.85] tracking-[-.07em]">
              Terminou a live.
              <br />
              <span className="text-primary">O podcast já vai.</span>
            </h1>
            <p className="mt-7 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              Cole o link do YouTube, corte a contagem regressiva e receba o
              áudio pronto para publicar — enquanto o assunto ainda está quente.
            </p>
          </div>
          <form onSubmit={importEpisode} className="import-card" noValidate>
            <div className="mb-7 flex items-start justify-between gap-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">
                  Novo episódio
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight">
                  Cole o link da live
                </h2>
              </div>
              <span className="step-chip">01</span>
            </div>
            <label
              className="mb-2 block text-sm font-semibold"
              htmlFor="youtube-url"
            >
              URL do YouTube
            </label>
            <div className="relative">
              <Link2 className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="youtube-url"
                aria-invalid={Boolean(urlError)}
                className="h-14 rounded-xl border-border bg-secondary/70 pl-11 pr-4 text-[15px] shadow-none focus-visible:ring-primary/30"
                onChange={(event) => {
                  setUrl(event.target.value);
                  setUrlError('');
                }}
                placeholder="youtube.com/watch?v=..."
                type="url"
                value={url}
              />
            </div>
            {urlError && (
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-destructive">
                <X className="size-3.5" />
                {urlError}
              </p>
            )}
            <Button
              className="mt-4 h-14 w-full rounded-xl text-base font-bold"
              disabled={!url.trim()}
              type="submit"
            >
              Importar live <ArrowRight className="size-4" />
            </Button>
            <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="size-3.5 text-primary" /> Título, duração e capa
              vêm automaticamente.
            </p>
          </form>
        </section>
        <section className="border-y border-border bg-card/55">
          <div className="mx-auto grid max-w-[1480px] gap-px bg-border px-5 md:grid-cols-3 md:px-10">
            {steps.map(({ Icon, number, title, copy }) => (
              <article className="bg-background px-1 py-7 md:px-7" key={number}>
                <div className="flex items-center justify-between">
                  <Icon className="size-5 text-primary" />
                  <span className="font-mono text-xs text-muted-foreground">
                    /{number}
                  </span>
                </div>
                <h3 className="mt-6 text-lg font-bold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {copy}
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>
    );

  if (screen === 'loading')
    return (
      <main className="min-h-screen">
        <Header compact onHome={goHome} />
        <div className="mx-auto grid min-h-[calc(100vh-80px)] max-w-xl place-items-center px-5 pb-24 text-center">
          <div className="w-full">
            <span className="mx-auto grid size-20 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary">
              <LoaderCircle className="size-9 animate-spin" />
            </span>
            <p className="mt-8 text-xs font-bold uppercase tracking-[.16em] text-primary">
              Importando do YouTube
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">
              Preparando a timeline…
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Buscando o vídeo e analisando a faixa de áudio.
            </p>
            <div className="mx-auto mt-8 max-w-sm overflow-hidden rounded-full bg-secondary">
              <div className="loading-bar h-1.5 rounded-full bg-primary" />
            </div>
          </div>
        </div>
      </main>
    );
  if (screen === 'exporting')
    return (
      <main className="min-h-screen">
        <Header compact onHome={goHome} />
        <div className="mx-auto grid min-h-[calc(100vh-80px)] max-w-xl place-items-center px-5 pb-24 text-center">
          <div className="w-full">
            <span className="mx-auto grid size-20 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary">
              <WandSparkles className="size-9 animate-pulse" />
            </span>
            <p className="mt-8 text-xs font-bold uppercase tracking-[.16em] text-primary">
              Gerando episódio
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">
              Deixando o áudio redondo.
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Aplicando cortes, normalização e metadados.
            </p>
            <Progress className="mx-auto mt-8 max-w-sm" value={progress} />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              {progress}% concluído
            </p>
          </div>
        </div>
      </main>
    );

  if (screen === 'ready')
    return (
      <main className="min-h-screen">
        <Header compact onHome={goHome} />
        <div className="mx-auto max-w-[1480px] px-5 pb-16 md:px-10">
          <div className="mb-8 flex flex-col justify-between gap-5 border-b border-border pb-7 pt-4 md:flex-row md:items-end">
            <div>
              <div className="eyebrow">
                <Podcast className="size-3.5" /> ESTÚDIO DE PUBLICAÇÃO
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-[-.05em] md:text-6xl">
                Do áudio ao feed.
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                Configure seu programa, revise o episódio e publique em um RSS
                estável. O Cortaê controla o feed; cada agregador decide quando
                indexar.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary">
              <ShieldCheck className="size-4" /> Hospedagem Cortaê
            </div>
          </div>
          <NoticeBanner notice={notice} />
          <div className="mb-7 grid gap-3 sm:grid-cols-3">
            <div className="metric-card">
              <span>Feed</span>
              <strong>{publicEpisodes ? 'Publicado' : 'Ainda vazio'}</strong>
              <small>
                {publicEpisodes
                  ? '1 episódio visível'
                  : 'Nenhum episódio público'}
              </small>
            </div>
            <div className="metric-card">
              <span>Identificador</span>
              <strong className="font-mono">
                {episode?.guid.slice(0, 8) || '—'}…
              </strong>
              <small>GUID permanente</small>
            </div>
            <div className="metric-card">
              <span>Distribuição</span>
              <strong>
                {
                  Object.values(destinations).filter(
                    (item) => item.status === 'available',
                  ).length
                }
                /4
              </strong>
              <small>plataformas disponíveis</small>
            </div>
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,.85fr)]">
            <section className="space-y-6">
              <div className="studio-card">
                <button
                  className="section-toggle"
                  onClick={() => setProgramOpen(!programOpen)}
                  aria-expanded={programOpen}
                >
                  <span className="flex items-center gap-3">
                    <span className="icon-box">
                      <Settings2 className="size-4" />
                    </span>
                    <span>
                      <span className="section-kicker">
                        01 · Dados obrigatórios
                      </span>
                      <span className="section-title">Seu programa</span>
                    </span>
                  </span>
                  <ChevronRight
                    className={`size-5 transition-transform ${programOpen ? 'rotate-90' : ''}`}
                  />
                </button>
                {programOpen && (
                  <div className="mt-7 grid gap-4 sm:grid-cols-2">
                    <Field label="Título do programa" id="program-title">
                      <Input
                        id="program-title"
                        value={program.title}
                        onChange={(event) =>
                          setProgram({
                            ...program,
                            title: event.target.value,
                            slug: program.slug || slugify(event.target.value),
                          })
                        }
                      />
                    </Field>
                    <Field label="Autor" id="program-author">
                      <Input
                        id="program-author"
                        value={program.author}
                        onChange={(event) =>
                          setProgram({ ...program, author: event.target.value })
                        }
                      />
                    </Field>
                    <Field
                      label="Descrição"
                      id="program-description"
                      className="sm:col-span-2"
                    >
                      <Textarea
                        id="program-description"
                        className="min-h-24 resize-y"
                        value={program.description}
                        onChange={(event) =>
                          setProgram({
                            ...program,
                            description: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Idioma" id="program-language">
                      <select
                        id="program-language"
                        className="form-select"
                        value={program.language}
                        onChange={(event) =>
                          setProgram({
                            ...program,
                            language: event.target.value,
                          })
                        }
                      >
                        <option value="pt-BR">Português (Brasil)</option>
                        <option value="en-US">English (US)</option>
                        <option value="es">Español</option>
                      </select>
                    </Field>
                    <Field label="Categoria" id="program-category">
                      <select
                        id="program-category"
                        className="form-select"
                        value={program.category}
                        onChange={(event) =>
                          setProgram({
                            ...program,
                            category: event.target.value,
                          })
                        }
                      >
                        <option>Sociedade e cultura</option>
                        <option>Notícias</option>
                        <option>Comédia</option>
                        <option>Negócios</option>
                        <option>Educação</option>
                        <option>Artes</option>
                      </select>
                    </Field>
                    <Field
                      label="E-mail de verificação público"
                      id="program-email"
                      className="sm:col-span-2"
                    >
                      <Input
                        id="program-email"
                        type="email"
                        value={program.email}
                        onChange={(event) =>
                          setProgram({ ...program, email: event.target.value })
                        }
                      />
                      <p className="field-hint">
                        <Info className="size-3.5" /> Este endereço aparecerá
                        publicamente no RSS. Recomendamos um alias dedicado.
                      </p>
                    </Field>
                    <div className="cover-field sm:col-span-2">
                      <div>
                        <p className="field-label">Capa do programa</p>
                        <p className="field-hint mt-1">
                          JPG ou PNG quadrado · 1400–3000 px · recomendado: 3000
                          × 3000
                        </p>
                      </div>
                      <label className="cover-upload">
                        <UploadCloud className="size-5" />
                        <span>{program.coverName || 'Escolher imagem'}</span>
                        <input
                          accept="image/jpeg,image/png"
                          type="file"
                          onChange={async (event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            if (
                              !['image/jpeg', 'image/png'].includes(file.type)
                            ) {
                              setNotice({
                                tone: 'error',
                                text: 'A capa precisa ser JPG ou PNG.',
                              });
                              return;
                            }
                            let valid = false;
                            try {
                              valid =
                                await coverMatchesPodcastRequirements(file);
                            } catch {
                              valid = false;
                            }
                            if (!valid) {
                              setNotice({
                                tone: 'error',
                                text: 'A capa precisa ser quadrada e ter entre 1400 e 3000 px.',
                              });
                              return;
                            }
                            setCoverFile(file);
                            setProgram({
                              ...program,
                              coverName: file.name,
                              coverValid: true,
                              coverUrl: `https://media.cortae.app/covers/${slugify(file.name.replace(/\.[^.]+$/, ''))}.${file.type === 'image/png' ? 'png' : 'jpg'}`,
                            });
                            setNotice({
                              tone: 'success',
                              text: 'Capa cadastrada para este programa.',
                            });
                          }}
                        />
                      </label>
                    </div>
                    <label className="check-row sm:col-span-2">
                      <input
                        checked={program.explicit}
                        type="checkbox"
                        onChange={(event) =>
                          setProgram({
                            ...program,
                            explicit: event.target.checked,
                          })
                        }
                      />
                      <span>Meu programa contém conteúdo explícito</span>
                    </label>
                  </div>
                )}
              </div>
              <div className="studio-card">
                <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <p className="section-kicker">02 · Revisão do episódio</p>
                    <h2 className="section-title mt-1">Dados para o feed</h2>
                  </div>
                  {episode && <StatusPill status={episode.status} />}
                </div>
                {episode ? (
                  <div className="space-y-5">
                    <Field label="Título do episódio" id="episode-title">
                      <Input
                        id="episode-title"
                        className="text-base font-semibold"
                        value={episode.title}
                        onChange={(event) =>
                          updateEpisode({ title: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Descrição" id="episode-description">
                      <Textarea
                        id="episode-description"
                        className="min-h-28 resize-y"
                        value={episode.description}
                        onChange={(event) =>
                          updateEpisode({ description: event.target.value })
                        }
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="Tipo" id="episode-kind">
                        <select
                          id="episode-kind"
                          className="form-select"
                          value={episode.kind}
                          onChange={(event) =>
                            updateEpisode({
                              kind: event.target.value as EpisodeKind,
                            })
                          }
                        >
                          <option value="full">Episódio completo</option>
                          <option value="trailer">Trailer</option>
                          <option value="bonus">Bônus</option>
                        </select>
                      </Field>
                      <Field label="Temporada" id="episode-season">
                        <Input
                          id="episode-season"
                          inputMode="numeric"
                          placeholder="Opcional"
                          value={episode.season}
                          onChange={(event) =>
                            updateEpisode({
                              season: event.target.value.replace(/\D/g, ''),
                            })
                          }
                        />
                      </Field>
                      <Field label="Número" id="episode-number">
                        <Input
                          id="episode-number"
                          inputMode="numeric"
                          placeholder="Opcional"
                          value={episode.number}
                          onChange={(event) =>
                            updateEpisode({
                              number: event.target.value.replace(/\D/g, ''),
                            })
                          }
                        />
                      </Field>
                    </div>
                    <label className="check-row">
                      <input
                        checked={episode.explicit}
                        type="checkbox"
                        onChange={(event) =>
                          updateEpisode({ explicit: event.target.checked })
                        }
                      />
                      <span>Este episódio contém conteúdo explícito</span>
                    </label>
                    <div className="audio-summary">
                      <span className="icon-box">
                        <FileAudio className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">
                          {episode.audioName}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {episode.mimeType} · {formatBytes(episode.sizeBytes)}{' '}
                          · {formatDuration(episode.duration)}
                        </p>
                      </div>
                      <button
                        className="text-xs font-bold text-primary hover:underline"
                        onClick={() => setConfirmAudioReplace(true)}
                      >
                        Trocar áudio
                      </button>
                    </div>
                    <div className="schedule-box">
                      <div className="flex items-start gap-3">
                        <CalendarClock className="mt-0.5 size-5 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold">Quando publicar?</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Datas são convertidas e armazenadas em UTC. O fuso
                            fica salvo para você revisar depois.
                          </p>
                          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px]">
                            <label className="sr-only" htmlFor="publish-at">
                              Data e hora de publicação
                            </label>
                            <Input
                              id="publish-at"
                              type="datetime-local"
                              value={
                                episode.publishAt
                                  ? isoToLocalDateTime(
                                      episode.publishAt,
                                      episode.timezone,
                                    )
                                  : ''
                              }
                              onChange={(event) =>
                                updateEpisode({
                                  publishAt: event.target.value
                                    ? localDateTimeToIso(
                                        event.target.value,
                                        episode.timezone,
                                      )
                                    : '',
                                })
                              }
                            />
                            <select
                              aria-label="Fuso horário"
                              className="form-select"
                              value={episode.timezone}
                              onChange={(event) =>
                                updateEpisode({ timezone: event.target.value })
                              }
                            >
                              <option value="America/Sao_Paulo">
                                Brasília (BRT)
                              </option>
                              <option value="America/New_York">
                                Nova York (ET)
                              </option>
                              <option value="Europe/Lisbon">
                                Lisboa (WET)
                              </option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
                      <Button
                        className="rounded-xl"
                        disabled={publishing}
                        onClick={saveDraft}
                        variant="outline"
                      >
                        <Save className="size-4" /> Salvar rascunho
                      </Button>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Button
                          className="rounded-xl"
                          disabled={
                            publishing || episode.status === 'published'
                          }
                          onClick={scheduleEpisode}
                          variant="outline"
                        >
                          <CalendarClock className="size-4" /> Agendar
                        </Button>
                        <Button
                          className="rounded-xl font-bold"
                          disabled={
                            publishing || episode.status === 'published'
                          }
                          onClick={publishNow}
                        >
                          <Radio className="size-4" /> Publicar agora
                        </Button>
                      </div>
                    </div>
                    {episode.status === 'scheduled' && (
                      <button
                        className="text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
                        onClick={cancelSchedule}
                      >
                        Cancelar agendamento
                      </button>
                    )}
                    {episode.status === 'published' && (
                      <p className="flex items-center gap-2 text-xs font-semibold text-primary">
                        <CheckCircle2 className="size-4" /> Publicado no feed em{' '}
                        {new Date(episode.publishedAt).toLocaleString('pt-BR')}
                      </p>
                    )}
                    {publishing && (
                      <output className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" />{' '}
                        Salvando no armazenamento público…
                      </output>
                    )}
                  </div>
                ) : (
                  <div className="empty-state">
                    <LoaderCircle className="size-5 animate-spin text-primary" />
                    <p>Preparando o arquivo final…</p>
                  </div>
                )}
              </div>
            </section>
            <aside className="space-y-6">
              <div className="feed-card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="section-kicker">03 · Seu endereço público</p>
                    <h2 className="section-title mt-1">Feed RSS estável</h2>
                  </div>
                  <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
                    <Globe2 className="size-5" />
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  Cadastre esta URL uma única vez nos agregadores. Cada novo
                  episódio publicado atualiza o feed automaticamente.
                </p>
                <div className="feed-url mt-5">
                  <code>{feed}</code>
                  <Button
                    aria-label="Copiar URL do feed"
                    className="size-9 shrink-0 rounded-lg"
                    onClick={copyFeed}
                    size="icon"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    className="rounded-lg"
                    onClick={openFeedPreview}
                    variant="outline"
                    size="sm"
                  >
                    <FileText className="size-3.5" /> Ver XML
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    {publicEpisodes
                      ? 'Feed válido · 1 episódio'
                      : 'Feed válido · sem episódios'}
                  </span>
                </div>
                <button
                  className="feed-toggle mt-6"
                  onClick={() => setFeedOpen(!feedOpen)}
                >
                  {feedOpen
                    ? 'Ocultar detalhes técnicos'
                    : 'Ver detalhes técnicos'}
                  <ChevronRight
                    className={`size-4 transition-transform ${feedOpen ? 'rotate-90' : ''}`}
                  />
                </button>
                {feedOpen && (
                  <div className="mt-4 space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
                    <p className="flex justify-between gap-4">
                      <span>Formato</span>
                      <strong className="text-foreground">
                        RSS 2.0 · UTF-8
                      </strong>
                    </p>
                    <p className="flex justify-between gap-4">
                      <span>GUID</span>
                      <strong className="font-mono text-foreground">
                        {episode?.guid.slice(0, 12) || '—'}…
                      </strong>
                    </p>
                    <p className="flex justify-between gap-4">
                      <span>Enclosure</span>
                      <strong className="text-foreground">HEAD · Range</strong>
                    </p>
                    <p className="flex justify-between gap-4">
                      <span>Ordenação</span>
                      <strong className="text-foreground">
                        Mais recente primeiro
                      </strong>
                    </p>
                  </div>
                )}
              </div>
              <div className="studio-card">
                <div className="flex items-start gap-3">
                  <span className="icon-box">
                    <Link2 className="size-4" />
                  </span>
                  <div>
                    <p className="section-kicker">04 · Distribuição manual</p>
                    <h2 className="section-title mt-1">Conectar agregadores</h2>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  O Cortaê não envia episódios por APIs. Você cadastra o feed
                  uma vez e informa aqui quando cada plataforma avançar.
                </p>
                <div className="mt-5 space-y-3">
                  {Object.entries(platformData).map(([id, data]) => {
                    const destination = destinations[id];
                    return (
                      <div className="platform-card" key={id}>
                        <div className="flex items-start gap-3">
                          <span className="platform-logo">{data.short}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold">{data.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {data.description}
                            </p>
                          </div>
                          <DestinationStatusSelect
                            label={data.name}
                            value={destination.status}
                            onChange={(status) =>
                              updateDestination(id, { status })
                            }
                          />
                        </div>
                        <p className="mt-3 text-xs leading-5 text-muted-foreground">
                          {data.instructions}
                        </p>
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <Button
                            className="h-9 flex-1 rounded-lg text-xs"
                            onClick={copyFeed}
                            variant="outline"
                          >
                            <Copy className="size-3.5" /> Copiar feed
                          </Button>
                          <a
                            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-secondary"
                            href={data.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Abrir central <ExternalLink className="size-3.5" />
                          </a>
                        </div>
                        <label
                          className="mt-3 block text-[11px] font-semibold text-muted-foreground"
                          htmlFor={`${id}-url`}
                        >
                          Link público (opcional)
                          <Input
                            id={`${id}-url`}
                            className="mt-1 h-9 text-xs"
                            placeholder="https://..."
                            value={destination.publicUrl}
                            onChange={(event) =>
                              updateDestination(id, {
                                publicUrl: event.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-5 flex items-start gap-2 text-[11px] leading-5 text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />{' '}
                  Estados são informados por você. Não simulamos confirmação
                  automática de catálogo.
                </p>
              </div>
              <div className="external-feed-card">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-4 text-amber-300" />
                  <p className="text-sm font-bold">
                    Já tenho um feed em outro host
                  </p>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Migração, redirect 301 e publicação em um host externo ainda
                  não fazem parte desta versão. Você pode continuar baixando o
                  arquivo final.
                </p>
                <Button
                  className="mt-4 h-9 rounded-lg text-xs"
                  onClick={downloadAudio}
                  variant="outline"
                >
                  <Download className="size-3.5" /> Baixar arquivo final
                </Button>
              </div>
            </aside>
          </div>
        </div>
        <AlertDialog
          open={confirmAudioReplace}
          onOpenChange={setConfirmAudioReplace}
        >
          <AlertDialogContent className="border-border bg-card p-6 sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-amber-400/10 text-amber-300">
                <AlertTriangle />
              </AlertDialogMedia>
              <AlertDialogTitle>Trocar áudio publicado?</AlertDialogTitle>
              <AlertDialogDescription>
                Agregadores podem manter cópias em cache ou exigir
                reprocessamento. O GUID permanecerá igual, mas a atualização
                pode não ser imediata.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-2 border-border bg-secondary/40">
              <AlertDialogCancel onClick={() => setConfirmAudioReplace(false)}>
                Manter áudio
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmAudioReplace(false);
                  setNotice({
                    tone: 'info',
                    text: 'A troca de áudio será liberada quando o armazenamento do arquivo estiver conectado.',
                  });
                }}
              >
                Entendi
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    );

  return (
    <main className="min-h-screen">
      <Header compact onHome={goHome} />
      <div className="mx-auto max-w-[1320px] px-5 pb-12 md:px-10">
        <button
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          onClick={goHome}
        >
          <ArrowLeft className="size-4" /> Trocar vídeo
        </button>
        <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="eyebrow">
              <Scissors className="size-3.5" /> CORTE DO EPISÓDIO
            </div>
            <h1 className="mt-4 max-w-3xl text-3xl font-black tracking-[-.04em] md:text-5xl">
              {episodeTitle}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Ao vivo · 02 set 2026 · Duração original {formatTime(DURATION)}
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold">
            <span className="size-2 rounded-full bg-primary" /> Live importada
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
          <section className="rounded-3xl border border-border bg-card p-5 md:p-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">
                  Timeline
                </p>
                <h2 className="mt-1 text-xl font-bold">
                  Onde o programa começa?
                </h2>
              </div>
              <Button
                className="rounded-full"
                onClick={() => {
                  setTrim([73, 5458]);
                  setPosition(73);
                }}
                size="sm"
                variant="ghost"
              >
                <RotateCcw className="size-3.5" /> Restaurar
              </Button>
            </div>
            <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-background p-4 md:p-6">
              <div className="relative h-44">
                <div
                  className="absolute inset-x-0 top-5 flex h-28 items-center gap-[3px] overflow-hidden"
                  aria-hidden="true"
                >
                  {bars.map((height, index) => (
                    <span
                      className="min-w-[2px] flex-1 rounded-full bg-primary/65"
                      key={index}
                      style={{
                        height: `${height}%`,
                        opacity:
                          (index / bars.length) * 100 < startPercent ||
                          (index / bars.length) * 100 > endPercent
                            ? 0.16
                            : 0.9,
                      }}
                    />
                  ))}
                </div>
                <div className="absolute bottom-0 left-0 right-0 px-1">
                  <Slider
                    aria-label="Selecionar início e fim do episódio"
                    min={0}
                    max={DURATION}
                    step={1}
                    value={trim}
                    onValueChange={(value) => {
                      const next = value as number[];
                      setTrim(next);
                      setPosition(
                        Math.max(next[0], Math.min(position, next[1])),
                      );
                    }}
                  />
                </div>
                <div
                  className="pointer-events-none absolute top-3 h-32 w-px bg-white/80"
                  style={{ left: `${positionPercent}%` }}
                >
                  <span className="absolute -left-1.5 -top-1 size-3 rounded-full border-2 border-background bg-white" />
                </div>
                <span
                  className="absolute bottom-5 font-mono text-[10px] text-muted-foreground"
                  style={{
                    left: `${startPercent}%`,
                    transform: 'translateX(-4px)',
                  }}
                >
                  {formatTime(trim[0])}
                </span>
                <span
                  className="absolute bottom-5 font-mono text-[10px] text-muted-foreground"
                  style={{
                    left: `${endPercent}%`,
                    transform: 'translateX(-100%)',
                  }}
                >
                  {formatTime(trim[1])}
                </span>
              </div>
              <div className="mt-4 flex items-center gap-4 border-t border-border pt-4">
                <Button
                  aria-label={playing ? 'Pausar' : 'Reproduzir'}
                  className="size-11 rounded-full"
                  onClick={() => setPlaying(!playing)}
                  size="icon"
                >
                  {playing ? <Pause /> : <Play className="ml-0.5" />}
                </Button>
                <div className="font-mono text-sm">
                  <span className="text-foreground">
                    {formatTime(position)}
                  </span>
                  <span className="text-muted-foreground">
                    {' '}
                    / {formatTime(DURATION)}
                  </span>
                </div>
                <Volume2 className="ml-auto size-4 text-muted-foreground" />
              </div>
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
                onCommit={(seconds) =>
                  setTrim([trim[0], Math.max(trim[0] + 1, seconds)])
                }
              />
            </div>
            <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/[.06] p-4 text-sm sm:flex-row sm:items-center">
              <Info className="size-4 shrink-0 text-primary" />
              <p className="text-muted-foreground">
                <strong className="text-foreground">Corte atual:</strong>{' '}
                {formatTime(trim[0])} no início e{' '}
                {formatTime(DURATION - trim[1])} no final.
              </p>
              <span className="sm:ml-auto whitespace-nowrap font-mono text-xs text-primary">
                {formatTime(cutDuration)} finais
              </span>
            </div>
          </section>
          <aside className="rounded-3xl border border-border bg-card p-5 md:p-6">
            <p className="text-xs font-bold uppercase tracking-[.13em] text-muted-foreground">
              Saída do arquivo
            </p>
            <h2 className="mt-2 text-xl font-bold">Detalhes do episódio</h2>
            <label
              className="mt-7 block text-sm font-semibold"
              htmlFor="filename"
            >
              Nome do arquivo
            </label>
            <div className="mt-2 flex items-center rounded-xl border border-border bg-background pr-3 focus-within:ring-2 focus-within:ring-primary/30">
              <Input
                id="filename"
                className="h-12 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0"
                value={fileName}
                onChange={(event) => setFileName(event.target.value)}
              />
              <span className="text-xs text-muted-foreground">.mp3</span>
            </div>
            <label
              className="mt-5 block text-sm font-semibold"
              htmlFor="format"
            >
              Formato
            </label>
            <select
              id="format"
              className="mt-2 h-12 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              value={format}
              onChange={(event) => setFormat(event.target.value)}
            >
              <option>MP3 · 128 kbps</option>
              <option>MP3 · 192 kbps</option>
              <option>AAC · 128 kbps</option>
            </select>
            <div className="my-6 h-px bg-border" />
            <div className="space-y-3 text-sm">
              <p className="flex justify-between text-muted-foreground">
                <span>Duração</span>
                <strong className="font-mono text-foreground">
                  {formatTime(cutDuration)}
                </strong>
              </p>
              <p className="flex justify-between text-muted-foreground">
                <span>Tamanho estimado</span>
                <strong className="text-foreground">~{fileSize} MB</strong>
              </p>
              <p className="flex justify-between text-muted-foreground">
                <span>Normalização</span>
                <strong className="text-foreground">-16 LUFS</strong>
              </p>
            </div>
            <Button
              className="mt-7 h-13 w-full rounded-xl text-sm font-bold"
              onClick={beginExport}
            >
              Gerar áudio <ChevronRight className="size-4" />
            </Button>
            <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">
              Depois de gerar, você poderá revisar e publicar no feed RSS.
            </p>
          </aside>
        </div>
      </div>
      <AlertDialog open={confirmUncut} onOpenChange={setConfirmUncut}>
        <AlertDialogContent className="border-border bg-card p-6 sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-amber-400/10 text-amber-300">
              <Scissors />
            </AlertDialogMedia>
            <AlertDialogTitle>O início não foi cortado</AlertDialogTitle>
            <AlertDialogDescription>
              A contagem regressiva pode ir junto para o podcast. Deseja gerar o
              áudio mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-2 border-border bg-secondary/40">
            <AlertDialogCancel onClick={() => setConfirmUncut(false)}>
              Voltar e cortar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmUncut(false);
                setScreen('exporting');
              }}
            >
              Gerar sem cortar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function Field({
  label,
  id,
  className = '',
  children,
}: {
  label: string;
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`} htmlFor={id}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
