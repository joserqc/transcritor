import { useEffect, useMemo, useRef, useState } from "react"
import {
  CheckCircle2,
  ClipboardCheck,
  FileAudio,
  FileText,
  FolderKanban,
  ListChecks,
  Loader2,
  Power,
  XCircle,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"

const navItems = [
  {
    id: "transcribe",
    label: "Transcrever Video",
    icon: FileAudio,
    description: "Enviar mp4 e acompanhar o progresso",
  },
  {
    id: "transcriptions",
    label: "Visualizar Transcricoes",
    icon: FileText,
    description: "Abrir transcricoes em Markdown",
  },
  {
    id: "create-ata",
    label: "Criar ATA",
    icon: ClipboardCheck,
    description: "Gerar ata com prompt customizado",
  },
  {
    id: "atas",
    label: "Visualizar ATAS",
    icon: ListChecks,
    description: "Consultar atas ja criadas",
  },
  {
    id: "by-client",
    label: "Por Cliente",
    icon: FolderKanban,
    description: "Filtrar e indexar por cliente",
  },
] as const

type NavKey = (typeof navItems)[number]["id"]

// Use the same protocol/host as the frontend to avoid CORS mismatches
const API_BASE = `${window.location.protocol}//${window.location.hostname}:8001`

type Transcript = {
  id: string
  fileName: string
  createdAt: string
  duration: string
  status: string
  client?: string | null
}

type Ata = {
  id: string
  title: string
  createdAt: string
  sourceId: string
  client?: string | null
}

function MarkdownViewer({ content }: { content: string }) {
  return (
    <div className="prose prose-slate max-w-none prose-headings:font-serif prose-h1:text-3xl prose-h2:text-2xl prose-strong:text-slate-900">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

const OPENROUTER_MODELS = [
  "anthropic/claude-3.5-sonnet",
  "anthropic/claude-3-opus",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "google/gemini-pro-1.5",
]
const OPENAI_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"]

function App() {
  const [active, setActive] = useState<NavKey>("transcribe")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [done, setDone] = useState(false)
  const [jobError, setJobError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [transcriptions, setTranscriptions] = useState<Transcript[]>([])
  const [atas, setAtas] = useState<Ata[]>([])
  const [openTranscriptId, setOpenTranscriptId] = useState<string | null>(null)
  const [openTranscriptContent, setOpenTranscriptContent] = useState<string | null>(
    null,
  )
  const [openAtaId, setOpenAtaId] = useState<string | null>(null)
  const [openAtaContent, setOpenAtaContent] = useState<string | null>(null)
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string | null>(
    null,
  )

  const [prompt, setPrompt] = useState(
    "Crie uma ATA objetiva com decisoes, pendencias e proximos passos.",
  )
  const [createdAtaContent, setCreatedAtaContent] = useState<string | null>(null)
  const [createdAtaId, setCreatedAtaId] = useState<string | null>(null)
  const [provider, setProvider] = useState<"openrouter" | "openai">("openrouter")
  const [ataModel, setAtaModel] = useState(OPENROUTER_MODELS[0])
  const [isCreatingAta, setIsCreatingAta] = useState(false)
  const [ataError, setAtaError] = useState<string | null>(null)
  const [diarize, setDiarize] = useState(true)

  // Client filtering state
  const [clients, setClients] = useState<string[]>([])
  const [selectedClientFilter, setSelectedClientFilter] = useState<string>("")
  const [filteredTranscriptions, setFilteredTranscriptions] = useState<Transcript[]>([])
  const [filteredAtas, setFilteredAtas] = useState<Ata[]>([])
  const [editingClientId, setEditingClientId] = useState<string | null>(null)
  const [editingClientType, setEditingClientType] = useState<"transcription" | "ata" | null>(null)
  const [editingClientValue, setEditingClientValue] = useState("")

  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
      }
    }
  }, [])

  const progressLabel = useMemo(() => {
    if (!isTranscribing && done) return "Finalizado!"
    if (progress < 3) return "Iniciando..."
    if (progress < 5) return "Extraindo audio"
    if (progress < 90) return "Transcrevendo com GPU"
    if (progress < 95) return "Processando segmentos"
    if (progress < 100) return "Gerando Markdown"
    return "Finalizando..."
  }, [done, isTranscribing, progress])

  const selectedTranscript = useMemo(
    () => transcriptions.find((item) => item.id === selectedTranscriptId) ?? null,
    [selectedTranscriptId, transcriptions],
  )

  const fetchTranscriptions = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/transcriptions`)
      if (!response.ok) return
      const data = (await response.json()) as Transcript[]
      setTranscriptions(data)
    } catch {
      setTranscriptions([])
    }
  }

  const fetchAtas = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/atas`)
      if (!response.ok) return
      const data = (await response.json()) as Ata[]
      setAtas(data)
    } catch {
      setAtas([])
    }
  }

  const fetchClients = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/clients`)
      if (!response.ok) return
      const data = (await response.json()) as string[]
      setClients(data)
    } catch {
      setClients([])
    }
  }

  const fetchFilteredData = async (clientFilter: string) => {
    try {
      const params = clientFilter ? `?client=${encodeURIComponent(clientFilter)}` : ""
      const [transRes, atasRes] = await Promise.all([
        fetch(`${API_BASE}/api/by-client/transcriptions${params}`),
        fetch(`${API_BASE}/api/by-client/atas${params}`),
      ])
      if (transRes.ok) {
        const data = (await transRes.json()) as Transcript[]
        setFilteredTranscriptions(data)
      }
      if (atasRes.ok) {
        const data = (await atasRes.json()) as Ata[]
        setFilteredAtas(data)
      }
    } catch {
      setFilteredTranscriptions([])
      setFilteredAtas([])
    }
  }

  const updateClient = async (id: string, type: "transcription" | "ata", newClient: string) => {
    const endpoint = type === "transcription"
      ? `${API_BASE}/api/transcriptions/${id}/client`
      : `${API_BASE}/api/atas/${id}/client`

    try {
      const resp = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: newClient }),
      })
      if (!resp.ok) throw new Error("Falha ao atualizar cliente")

      // Refresh data
      fetchClients()
      fetchFilteredData(selectedClientFilter)
      fetchTranscriptions()
      fetchAtas()
      return true
    } catch (e) {
      alert((e as Error).message || "Erro ao atualizar cliente")
      return false
    }
  }

  const handleShutdown = async () => {
    if (!confirm("Deseja realmente encerrar o servidor?")) {
      return
    }
    
    try {
      await fetch(`${API_BASE}/api/shutdown`, { method: "POST" })
      alert("Servidor será encerrado em breve. A janela do navegador pode ser fechada.")
    } catch (error) {
      console.error("Erro ao encerrar servidor:", error)
    }
  }

  useEffect(() => {
    fetchTranscriptions()
    fetchAtas()
    fetchClients()
  }, [])

  useEffect(() => {
    if (active === "by-client") {
      fetchClients()
      fetchFilteredData(selectedClientFilter)
    }
  }, [active, selectedClientFilter])

  useEffect(() => {
    setAtaModel(
      provider === "openrouter" ? OPENROUTER_MODELS[0] : OPENAI_MODELS[0],
    )
  }, [provider])

  useEffect(() => {
    if (!openTranscriptId) {
      setOpenTranscriptContent(null)
      return
    }

    fetch(`${API_BASE}/api/transcriptions/${openTranscriptId}/markdown`)
      .then((response) => response.json())
      .then((data) => setOpenTranscriptContent(data.content ?? ""))
      .catch(() => setOpenTranscriptContent(""))
  }, [openTranscriptId])

  useEffect(() => {
    if (!openAtaId) {
      setOpenAtaContent(null)
      return
    }

    fetch(`${API_BASE}/api/atas/${openAtaId}/markdown`)
      .then((response) => response.json())
      .then((data) => setOpenAtaContent(data.content ?? ""))
      .catch(() => setOpenAtaContent(""))
  }, [openAtaId])

  const pollJob = (currentJobId: string) => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
    }

    timerRef.current = window.setInterval(async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/transcriptions/${currentJobId}`,
        )
        if (!response.ok) return
        const data = await response.json()
        setProgress(data.progress ?? 0)

        if (data.status === "completed") {
          if (timerRef.current) {
            window.clearInterval(timerRef.current)
            timerRef.current = null
          }
          setIsTranscribing(false)
          setDone(true)
          setJobError(null)
          fetchTranscriptions()
        }

        if (data.status === "failed") {
          if (timerRef.current) {
            window.clearInterval(timerRef.current)
            timerRef.current = null
          }
          setIsTranscribing(false)
          setJobError(data.error ?? "Erro na transcricao")
        }
      } catch {
        // ignore
      }
    }, 1200)
  }

  const handleTranscribe = async () => {
    if (!selectedFile || isTranscribing) return
    setIsTranscribing(true)
    setDone(false)
    setProgress(3)
    setJobError(null)

    const formData = new FormData()
    formData.append("file", selectedFile)
    formData.append("diarize", diarize ? "true" : "false")

    try {
      const response = await fetch(`${API_BASE}/api/transcriptions`, {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        throw new Error("Falha ao iniciar transcricao")
      }

      const data = await response.json()
      setJobId(data.id)
      pollJob(data.id)
    } catch (error) {
      setIsTranscribing(false)
      setJobError((error as Error).message)
    }
  }

  const handleCreateAta = async () => {
    if (!selectedTranscript) return
    setIsCreatingAta(true)
    setAtaError(null)
    setCreatedAtaContent("")
    setCreatedAtaId(null)
    try {
      const response = await fetch(`${API_BASE}/api/atas/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcriptionId: selectedTranscript.id,
          prompt,
          provider,
          model: ataModel,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error("Falha ao criar ATA")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder("utf-8")
      let buffer = ""
      let content = ""

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""

        for (const part of parts) {
          const lines = part.split("\n")
          let event = "message"
          let data = ""
          for (const line of lines) {
            if (line.startsWith("event:")) {
              event = line.replace("event:", "").trim()
            }
            if (line.startsWith("data:")) {
              data += line.replace("data:", "").trim()
            }
          }

          if (!data) continue

          if (event === "chunk") {
            try {
              const payload = JSON.parse(data)
              content += payload.t ?? ""
              setCreatedAtaContent(content)
            } catch {
              // ignore chunk parse errors
            }
          }

          if (event === "done") {
            try {
              const payload = JSON.parse(data) as Ata
              setAtas((prev) => [payload, ...prev])
              setCreatedAtaId(payload.id)
              setCreatedAtaContent(`# ${payload.title}\n\n${content}`)
            } catch {
              setCreatedAtaContent(content)
            }
          }

          if (event === "error") {
            try {
              const payload = JSON.parse(data)
              setAtaError(payload.message ?? "Erro ao gerar ATA")
            } catch {
              setAtaError("Erro ao gerar ATA")
            }
          }
        }
      }
    } catch (error) {
      setAtaError((error as Error).message)
    } finally {
      setIsCreatingAta(false)
    }
  }

  return (
    <div className="min-h-screen">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="flex w-full flex-col gap-6 border-b border-white/40 bg-white/70 px-6 py-8 backdrop-blur-lg lg:min-h-screen lg:w-80 lg:border-b-0 lg:border-r">
          <div>
            <h1 className="font-serif text-3xl text-slate-900">
              Transcritor Local
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              GPU-first para reunioes OBS com diarizacao.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge className="bg-slate-900 text-white">CUDA</Badge>
              <Badge variant="outline">Local only</Badge>
              <Badge variant="outline">pt-BR</Badge>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-3">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = active === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  className={cn(
                    "group flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition",
                    isActive
                      ? "border-slate-900/20 bg-white shadow-glow"
                      : "border-transparent bg-white/40 text-slate-600 hover:border-white/80 hover:bg-white",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1 flex h-9 w-9 items-center justify-center rounded-xl",
                      isActive
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-500 group-hover:text-slate-900",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span>
                    <span className="text-sm font-semibold text-slate-900">
                      {item.label}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {item.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>

          <div className="space-y-3">
            <Button
              onClick={handleShutdown}
              variant="outline"
              className="w-full justify-start gap-3 rounded-xl border-red-200 px-4 py-6 text-red-600 hover:bg-red-50 hover:text-red-700"
            >
              <Power className="h-5 w-5" />
              <span className="text-sm font-semibold">Encerrar Servidor</span>
            </Button>

            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse-soft rounded-full bg-emerald-500" />
                Ambiente local pronto
              </div>
              <p className="mt-2">Conectado ao motor local via API.</p>
            </div>
          </div>
        </aside>

        <main className="flex-1 px-6 py-10 lg:px-12">{active === "transcribe" && (
            <section className="space-y-6">
              <header>
                <h2 className="font-serif text-3xl text-slate-900">
                  Transcrever Video
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Selecione um .mp4 do OBS e dispare a transcricao local.
                </p>
              </header>

              <Card className="border-slate-200/80 bg-white/80 shadow-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <FileAudio className="h-5 w-5 text-slate-600" />
                    Enviar arquivo
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    type="file"
                    accept="video/mp4"
                    onChange={(event) => {
                      const file = event.target.files?.[0] ?? null
                      setSelectedFile(file)
                      setDone(false)
                      setProgress(0)
                    }}
                  />
                  {selectedFile ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
                      <Badge variant="outline">{selectedFile.name}</Badge>
                      <span>{(selectedFile.size / 1024 / 1024).toFixed(1)} MB</span>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Nenhum arquivo selecionado.
                    </p>
                  )}
                  <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 select-none">
                    <span>Separar participantes (diarizacao)</span>
                    <input
                      type="checkbox"
                      checked={diarize}
                      onChange={(event) => setDiarize(event.target.checked)}
                      className="h-4 w-4 accent-slate-900"
                    />
                  </label>
                  <Button
                    onClick={handleTranscribe}
                    disabled={!selectedFile || isTranscribing}
                    className="w-full rounded-2xl bg-slate-900 py-6 text-base shadow-lg shadow-slate-900/20"
                  >
                    {isTranscribing ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Transcrevendo...
                      </span>
                    ) : (
                      "Transcrever"
                    )}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-slate-200/80 bg-white/70">
                <CardHeader>
                  <CardTitle className="text-lg">Progresso</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between text-sm text-slate-600">
                    <span>{progressLabel}</span>
                    <span>{Math.round(progress)}%</span>
                  </div>
                  <Progress value={progress} />
                  {jobId && (
                    <p className="text-xs text-slate-400">Job: {jobId}</p>
                  )}
                  {done && (
                    <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 animate-stamp-in">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="text-sm font-semibold">Finalizado!</span>
                    </div>
                  )}
                  {jobError && (
                    <div className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-600">
                      <XCircle className="h-5 w-5" />
                      <span className="text-sm">{jobError}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          {active === "transcriptions" && (
            <section className="space-y-6">
              <header>
                <h2 className="font-serif text-3xl text-slate-900">
                  Visualizar Transcricoes
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Veja todas as transcricoes geradas e abra o Markdown completo.
                </p>
              </header>

              <Card className="border-slate-200/80 bg-white/80">
                <CardContent className="pt-6">
                  <div className="min-w-full overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Arquivo</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Duracao</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Acao</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transcriptions.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5}>
                              <span className="text-sm text-slate-500">
                                Nenhuma transcricao encontrada.
                              </span>
                            </TableCell>
                          </TableRow>
                        ) : (
                          transcriptions.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">
                                {item.fileName}
                              </TableCell>
                              <TableCell>{item.createdAt}</TableCell>
                              <TableCell>{item.duration}</TableCell>
                              <TableCell>
                                <Badge variant="outline">{item.status}</Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  onClick={() => setOpenTranscriptId(item.id)}
                                >
                                  Ver
                                </Button>
                                <Button
                                  variant="outline"
                                  className="ml-2"
                                  onClick={async () => {
                                    const current = item.fileName
                                    const name = window.prompt("Novo nome da transcricao:", current || "")
                                    if (!name || name.trim() === "" || name === current) return
                                    try {
                                      const resp = await fetch(`${API_BASE}/api/transcriptions/${item.id}/rename`, {
                                        method: "PATCH",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ name }),
                                      })
                                      if (!resp.ok) throw new Error("Falha ao renomear")
                                      const updated = await resp.json()
                                      setTranscriptions((prev) => prev.map((t) => (t.id === item.id ? { ...t, fileName: updated.fileName || name } : t)))
                                    } catch (e) {
                                      alert((e as Error).message || "Erro ao renomear")
                                    }
                                  }}
                                >
                                  Renomear
                                </Button>
                                <Button
                                  variant="outline"
                                  className="ml-2 text-rose-600 hover:text-rose-700"
                                  onClick={async () => {
                                    const confirmed = window.confirm(`Deseja deletar a transcricao "${item.fileName}"?`)
                                    if (!confirmed) return
                                    try {
                                      // Use alternate route to avoid collision with job status path
                                      const resp = await fetch(`${API_BASE}/api/transcriptions/${item.id}/delete`, {
                                        method: "DELETE",
                                      })
                                      if (!resp.ok) throw new Error("Falha ao deletar")
                                      setTranscriptions((prev) => prev.filter((t) => t.id !== item.id))
                                    } catch (e) {
                                      alert((e as Error).message || "Erro ao deletar")
                                    }
                                  }}
                                >
                                  Deletar
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {active === "create-ata" && (
            <section className="space-y-6">
              <header>
                <h2 className="font-serif text-3xl text-slate-900">Criar ATA</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Escolha uma transcricao, refine o prompt e gere uma ATA.
                </p>
              </header>

              <Card className="border-slate-200/80 bg-white/80">
                <CardContent className="space-y-6 pt-6">
                  <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">
                        Transcricao
                      </label>
                      <Select
                        value={selectedTranscriptId ?? ""}
                        onValueChange={(value) => setSelectedTranscriptId(value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma transcricao" />
                        </SelectTrigger>
                        <SelectContent>
                          {transcriptions.map((item) => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.fileName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-slate-700">
                        Modelo sugerido
                      </label>
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        {ataModel}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                      Provider LLM
                    </label>
                    <Select
                      value={provider}
                      onValueChange={(value) =>
                        setProvider(value as "openrouter" | "openai")
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o provider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openrouter">
                          OpenRouter (Claude Opus 4.5)
                        </SelectItem>
                        <SelectItem value="openai">
                          OpenAI (GPT-5.2-2025-12-11)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                      Modelo LLM
                    </label>
                    <Select
                      value={ataModel}
                      onValueChange={(value) => setAtaModel(value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o modelo" />
                      </SelectTrigger>
                      <SelectContent>
                        {(provider === "openrouter"
                          ? OPENROUTER_MODELS
                          : OPENAI_MODELS
                        ).map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                      Prompt
                    </label>
                    <Textarea
                      rows={5}
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                    />
                  </div>

                  <Button
                    onClick={handleCreateAta}
                    disabled={!selectedTranscript || isCreatingAta}
                    className="w-full rounded-2xl bg-slate-900 py-6 text-base shadow-lg shadow-slate-900/20"
                  >
                    {isCreatingAta ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Gerando ATA...
                      </span>
                    ) : (
                      "Criar ATA"
                    )}
                  </Button>
                </CardContent>
              </Card>

              {ataError && (
                <Card className="border-rose-200/80 bg-rose-50">
                  <CardContent className="flex items-center gap-3 pt-6 text-sm text-rose-600">
                    <XCircle className="h-4 w-4" />
                    {ataError}
                  </CardContent>
                </Card>
              )}

              {createdAtaContent && (
                <Card className="border-slate-200/80 bg-white/80">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-lg">ATA gerada</CardTitle>
                    {createdAtaId && (
                      <span className="flex items-center gap-2 text-sm text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" />
                        Salva automaticamente
                      </span>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="h-[500px] overflow-y-auto rounded-2xl border bg-white p-5">
                      <MarkdownViewer content={createdAtaContent} />
                    </div>
                    {createdAtaId && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setActive("atas")
                          setOpenAtaId(createdAtaId)
                        }}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        Ver ATA em Visualizar ATAS
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </section>
          )}

          {active === "atas" && (
            <section className="space-y-6">
              <header>
                <h2 className="font-serif text-3xl text-slate-900">
                  Visualizar ATAS
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Consulte todas as atas geradas e abra em Markdown.
                </p>
              </header>

              <Card className="border-slate-200/80 bg-white/80">
                <CardContent className="pt-6">
                  <div className="min-w-full overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Titulo</TableHead>
                          <TableHead>Transcricao</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead className="text-right">Acao</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {atas.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4}>
                              <span className="text-sm text-slate-500">
                                Nenhuma ATA encontrada.
                              </span>
                            </TableCell>
                          </TableRow>
                        ) : (
                          atas.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">
                                {item.title}
                              </TableCell>
                              <TableCell>{item.sourceId}</TableCell>
                              <TableCell>{item.createdAt}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  onClick={() => setOpenAtaId(item.id)}
                                >
                                  Ver
                                </Button>
                                <Button
                                  variant="outline"
                                  className="ml-2 text-rose-600 hover:text-rose-700"
                                  onClick={async () => {
                                    const confirmed = window.confirm(`Deseja deletar a ATA "${item.title}"?`)
                                    if (!confirmed) return
                                    try {
                                      const resp = await fetch(`${API_BASE}/api/atas/${item.id}`, {
                                        method: "DELETE",
                                      })
                                      if (!resp.ok) throw new Error("Falha ao deletar")
                                      setAtas((prev) => prev.filter((a) => a.id !== item.id))
                                    } catch (e) {
                                      alert((e as Error).message || "Erro ao deletar")
                                    }
                                  }}
                                >
                                  Deletar
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {active === "by-client" && (
            <section className="space-y-6">
              <header>
                <h2 className="font-serif text-3xl text-slate-900">
                  Por Cliente
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Filtre transcricoes e ATAs por cliente. Atribua clientes aos itens sem indexacao.
                </p>
              </header>

              <Card className="border-slate-200/80 bg-white/80">
                <CardContent className="space-y-4 pt-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">
                      Filtrar por Cliente
                    </label>
                    <Select
                      value={selectedClientFilter}
                      onValueChange={(value) => setSelectedClientFilter(value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Todos os clientes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Todos os clientes</SelectItem>
                        <SelectItem value="__unassigned__">Sem cliente (nao indexados)</SelectItem>
                        {clients.map((client) => (
                          <SelectItem key={client} value={client}>
                            {client}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-2">
                    {clients.length > 0 ? (
                      clients.map((client) => (
                        <Badge
                          key={client}
                          variant={selectedClientFilter === client ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => setSelectedClientFilter(selectedClientFilter === client ? "" : client)}
                        >
                          {client}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">Nenhum cliente cadastrado ainda.</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200/80 bg-white/80">
                <CardHeader>
                  <CardTitle className="text-lg">Transcricoes</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="min-w-full overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Arquivo</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Duracao</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead className="text-right">Acao</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTranscriptions.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5}>
                              <span className="text-sm text-slate-500">
                                Nenhuma transcricao encontrada.
                              </span>
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredTranscriptions.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">
                                {item.fileName}
                              </TableCell>
                              <TableCell>{item.createdAt}</TableCell>
                              <TableCell>{item.duration}</TableCell>
                              <TableCell>
                                {editingClientId === item.id && editingClientType === "transcription" ? (
                                  <div className="flex items-center gap-2">
                                    <Input
                                      value={editingClientValue}
                                      onChange={(e) => setEditingClientValue(e.target.value)}
                                      className="h-8 w-40"
                                      placeholder="Nome do cliente"
                                      list="client-suggestions"
                                      autoFocus
                                      onKeyDown={async (e) => {
                                        if (e.key === "Enter") {
                                          const success = await updateClient(item.id, "transcription", editingClientValue)
                                          if (success) {
                                            setEditingClientId(null)
                                            setEditingClientType(null)
                                          }
                                        } else if (e.key === "Escape") {
                                          setEditingClientId(null)
                                          setEditingClientType(null)
                                        }
                                      }}
                                    />
                                    <datalist id="client-suggestions">
                                      {clients.map((c) => (
                                        <option key={c} value={c} />
                                      ))}
                                    </datalist>
                                    <Button
                                      size="sm"
                                      onClick={async () => {
                                        const success = await updateClient(item.id, "transcription", editingClientValue)
                                        if (success) {
                                          setEditingClientId(null)
                                          setEditingClientType(null)
                                        }
                                      }}
                                    >
                                      Salvar
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setEditingClientId(null)
                                        setEditingClientType(null)
                                      }}
                                    >
                                      Cancelar
                                    </Button>
                                  </div>
                                ) : (
                                  <span
                                    className={cn(
                                      "cursor-pointer rounded px-2 py-1 hover:bg-slate-100",
                                      !item.client && "italic text-slate-400"
                                    )}
                                    onClick={() => {
                                      setEditingClientId(item.id)
                                      setEditingClientType("transcription")
                                      setEditingClientValue(item.client || "")
                                    }}
                                  >
                                    {item.client || "Clique para atribuir"}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  onClick={() => setOpenTranscriptId(item.id)}
                                >
                                  Ver
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200/80 bg-white/80">
                <CardHeader>
                  <CardTitle className="text-lg">ATAs</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="min-w-full overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Titulo</TableHead>
                          <TableHead>Data</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead className="text-right">Acao</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAtas.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4}>
                              <span className="text-sm text-slate-500">
                                Nenhuma ATA encontrada.
                              </span>
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredAtas.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">
                                {item.title}
                              </TableCell>
                              <TableCell>{item.createdAt}</TableCell>
                              <TableCell>
                                {editingClientId === item.id && editingClientType === "ata" ? (
                                  <div className="flex items-center gap-2">
                                    <Input
                                      value={editingClientValue}
                                      onChange={(e) => setEditingClientValue(e.target.value)}
                                      className="h-8 w-40"
                                      placeholder="Nome do cliente"
                                      list="client-suggestions-ata"
                                      autoFocus
                                      onKeyDown={async (e) => {
                                        if (e.key === "Enter") {
                                          const success = await updateClient(item.id, "ata", editingClientValue)
                                          if (success) {
                                            setEditingClientId(null)
                                            setEditingClientType(null)
                                          }
                                        } else if (e.key === "Escape") {
                                          setEditingClientId(null)
                                          setEditingClientType(null)
                                        }
                                      }}
                                    />
                                    <datalist id="client-suggestions-ata">
                                      {clients.map((c) => (
                                        <option key={c} value={c} />
                                      ))}
                                    </datalist>
                                    <Button
                                      size="sm"
                                      onClick={async () => {
                                        const success = await updateClient(item.id, "ata", editingClientValue)
                                        if (success) {
                                          setEditingClientId(null)
                                          setEditingClientType(null)
                                        }
                                      }}
                                    >
                                      Salvar
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        setEditingClientId(null)
                                        setEditingClientType(null)
                                      }}
                                    >
                                      Cancelar
                                    </Button>
                                  </div>
                                ) : (
                                  <span
                                    className={cn(
                                      "cursor-pointer rounded px-2 py-1 hover:bg-slate-100",
                                      !item.client && "italic text-slate-400"
                                    )}
                                    onClick={() => {
                                      setEditingClientId(item.id)
                                      setEditingClientType("ata")
                                      setEditingClientValue(item.client || "")
                                    }}
                                  >
                                    {item.client || "Clique para atribuir"}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  onClick={() => setOpenAtaId(item.id)}
                                >
                                  Ver
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}
        </main>
      </div>

      <Dialog
        open={!!openTranscriptId}
        onOpenChange={(open) => !open && setOpenTranscriptId(null)}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Transcricao completa</DialogTitle>
            <DialogDescription className="sr-only">
              Visualizacao do conteudo da transcricao em markdown
            </DialogDescription>
          </DialogHeader>
          {openTranscriptContent ? (
            <ScrollArea className="max-h-[70vh] rounded-2xl border bg-white p-6">
              <MarkdownViewer content={openTranscriptContent} />
            </ScrollArea>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando markdown...
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!openAtaId} onOpenChange={(open) => !open && setOpenAtaId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>ATA completa</DialogTitle>
            <DialogDescription className="sr-only">
              Visualizacao do conteudo da ATA em markdown
            </DialogDescription>
          </DialogHeader>
          {openAtaContent ? (
            <ScrollArea className="max-h-[70vh] rounded-2xl border bg-white p-6">
              <MarkdownViewer content={openAtaContent} />
            </ScrollArea>
          ) : (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando markdown...
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default App
