import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Eye,
  FileAudio,
  FileText,
  FolderKanban,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pencil,
  Power,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { Toaster } from "@/components/ui/sonner"

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

// Custom header sent on every state-changing request. Backend rejects without it.
// Forces a CORS preflight from other origins, blocking trivial local CSRF.
const CSRF_HEADER = { "X-Transcritor-Client": "web" } as const

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

// Copia o Markdown bruto para a área de transferência (ex.: colar no Obsidian).
async function copyMarkdown(content: string | null) {
  if (!content) return
  try {
    await navigator.clipboard.writeText(content)
    toast.success("Markdown copiado para a área de transferência")
  } catch {
    toast.error("Não foi possível copiar o Markdown")
  }
}

function MarkdownViewer({ content }: { content: string }) {
  return (
    <div className="prose prose-slate max-w-none prose-headings:font-serif prose-h1:text-3xl prose-h2:text-2xl prose-strong:text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}

// Maps a backend status string to a Badge variant for consistent visual weight.
function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  const value = status.toLowerCase()
  if (value.includes("final") || value.includes("complet")) return "default"
  if (value.includes("erro") || value.includes("fail")) return "destructive"
  if (value.includes("process") || value.includes("pend")) return "secondary"
  return "outline"
}

// --- Helpers de ordenacao da lista de transcricoes ---

type SortField = "date" | "name" | "duration"
type SortDir = "asc" | "desc"

// createdAt chega formatado como "DD/MM/YYYY HH:MM" (ver database.py)
function parseCreatedAt(value: string): number {
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
  if (!match) return 0
  const [, dd, mm, yyyy, hh, min] = match
  return new Date(+yyyy, +mm - 1, +dd, +hh, +min).getTime()
}

// duration chega como "HH:MM:SS" (ou "MM:SS")
function parseDuration(value: string | null | undefined): number {
  if (!value) return 0
  const parts = value.split(":").map(Number)
  if (parts.some((n) => Number.isNaN(n))) return 0
  return parts.reduce((acc, part) => acc * 60 + part, 0)
}

function SortableHeader({
  label,
  field,
  activeField,
  direction,
  onSort,
  className,
}: {
  label: string
  field: SortField
  activeField: SortField
  direction: SortDir
  onSort: (field: SortField) => void
  className?: string
}) {
  const isActive = activeField === field
  const Icon = !isActive ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          "-mx-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-left font-medium transition-colors hover:bg-muted",
          isActive ? "text-foreground" : "text-muted-foreground",
        )}
        aria-label={`Ordenar por ${label}`}
      >
        {label}
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            isActive ? "text-foreground" : "text-muted-foreground/50",
          )}
        />
      </button>
    </TableHead>
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

type DeleteTarget = { kind: "transcription" | "ata"; id: string; label: string }

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
  const [transLoading, setTransLoading] = useState(true)
  const [atasLoading, setAtasLoading] = useState(true)
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

  // Filtros e ordenacao da lista de transcricoes
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [sortField, setSortField] = useState<SortField>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [ataSearch, setAtaSearch] = useState("")

  // Dialogos de acao (renomear / deletar / encerrar)
  const [renameTarget, setRenameTarget] = useState<Transcript | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [shutdownOpen, setShutdownOpen] = useState(false)

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

  const activeItem = useMemo(
    () => navItems.find((item) => item.id === active) ?? navItems[0],
    [active],
  )

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

  // Status distintos presentes na lista, para alimentar o filtro
  const statusOptions = useMemo(
    () =>
      Array.from(new Set(transcriptions.map((item) => item.status).filter(Boolean))),
    [transcriptions],
  )

  // Lista exibida: filtrada por busca/status e ordenada pelo campo escolhido
  const displayedTranscriptions = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = transcriptions.filter((item) => {
      const matchesQuery =
        !query ||
        item.fileName.toLowerCase().includes(query) ||
        (item.client ?? "").toLowerCase().includes(query)
      const matchesStatus = statusFilter === "all" || item.status === statusFilter
      return matchesQuery && matchesStatus
    })

    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0
      if (sortField === "name") {
        comparison = a.fileName.localeCompare(b.fileName, "pt-BR", {
          sensitivity: "base",
        })
      } else if (sortField === "duration") {
        comparison = parseDuration(a.duration) - parseDuration(b.duration)
      } else {
        comparison = parseCreatedAt(a.createdAt) - parseCreatedAt(b.createdAt)
      }
      return sortDir === "asc" ? comparison : -comparison
    })

    return sorted
  }, [transcriptions, search, statusFilter, sortField, sortDir])

  const hasActiveFilters = search.trim() !== "" || statusFilter !== "all"

  const displayedAtas = useMemo(() => {
    const query = ataSearch.trim().toLowerCase()
    if (!query) return atas
    return atas.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        (item.client ?? "").toLowerCase().includes(query),
    )
  }, [atas, ataSearch])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))
    } else {
      setSortField(field)
      // Data e duracao iniciam decrescente (mais recente/maior primeiro); nome crescente
      setSortDir(field === "name" ? "asc" : "desc")
    }
  }

  const clearFilters = () => {
    setSearch("")
    setStatusFilter("all")
  }

  const fetchTranscriptions = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/transcriptions`)
      if (!response.ok) return
      const data = (await response.json()) as Transcript[]
      setTranscriptions(data)
    } catch {
      setTranscriptions([])
    } finally {
      setTransLoading(false)
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
    } finally {
      setAtasLoading(false)
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
        headers: { "Content-Type": "application/json", ...CSRF_HEADER },
        body: JSON.stringify({ client: newClient }),
      })
      if (!resp.ok) throw new Error("Falha ao atualizar cliente")

      // Refresh data
      fetchClients()
      fetchFilteredData(selectedClientFilter)
      fetchTranscriptions()
      fetchAtas()
      toast.success("Cliente atualizado")
      return true
    } catch (e) {
      toast.error((e as Error).message || "Erro ao atualizar cliente")
      return false
    }
  }

  const handleShutdown = async () => {
    try {
      await fetch(`${API_BASE}/api/shutdown`, { method: "POST", headers: CSRF_HEADER })
      toast.success("Servidor sera encerrado em breve.", {
        description: "A janela do navegador pode ser fechada.",
      })
    } catch (error) {
      console.error("Erro ao encerrar servidor:", error)
      toast.error("Erro ao encerrar servidor")
    } finally {
      setShutdownOpen(false)
    }
  }

  const submitRename = async () => {
    if (!renameTarget) return
    const name = renameValue.trim()
    if (!name || name === renameTarget.fileName) {
      setRenameTarget(null)
      return
    }
    try {
      const resp = await fetch(
        `${API_BASE}/api/transcriptions/${renameTarget.id}/rename`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...CSRF_HEADER },
          body: JSON.stringify({ name }),
        },
      )
      if (!resp.ok) throw new Error("Falha ao renomear")
      const updated = await resp.json()
      setTranscriptions((prev) =>
        prev.map((t) =>
          t.id === renameTarget.id
            ? { ...t, fileName: updated.fileName || name }
            : t,
        ),
      )
      toast.success("Transcricao renomeada")
    } catch (e) {
      toast.error((e as Error).message || "Erro ao renomear")
    } finally {
      setRenameTarget(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      if (deleteTarget.kind === "transcription") {
        // Use alternate route to avoid collision with job status path
        const resp = await fetch(
          `${API_BASE}/api/transcriptions/${deleteTarget.id}/delete`,
          { method: "DELETE", headers: CSRF_HEADER },
        )
        if (!resp.ok) throw new Error("Falha ao deletar")
        setTranscriptions((prev) => prev.filter((t) => t.id !== deleteTarget.id))
      } else {
        const resp = await fetch(`${API_BASE}/api/atas/${deleteTarget.id}`, {
          method: "DELETE",
          headers: CSRF_HEADER,
        })
        if (!resp.ok) throw new Error("Falha ao deletar")
        setAtas((prev) => prev.filter((a) => a.id !== deleteTarget.id))
      }
      toast.success("Item deletado")
    } catch (e) {
      toast.error((e as Error).message || "Erro ao deletar")
    } finally {
      setIsDeleting(false)
      setDeleteTarget(null)
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
          toast.success("Transcricao finalizada!")
        }

        if (data.status === "failed") {
          if (timerRef.current) {
            window.clearInterval(timerRef.current)
            timerRef.current = null
          }
          setIsTranscribing(false)
          setJobError(data.error ?? "Erro na transcricao")
          toast.error("Falha na transcricao", {
            description: data.error ?? undefined,
          })
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
        headers: CSRF_HEADER,
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
      toast.error((error as Error).message)
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
        headers: { "Content-Type": "application/json", ...CSRF_HEADER },
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
              toast.success("ATA gerada e salva")
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
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-3 px-1 py-2">
            <span className="flex aspect-square size-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
              <FileAudio className="size-5" />
            </span>
            <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
              <span className="font-serif text-base font-semibold text-sidebar-foreground">
                Transcritor
              </span>
              <span className="text-xs text-muted-foreground">Local · GPU-first</span>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navegacao</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const Icon = item.icon
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={active === item.id}
                        tooltip={item.label}
                        onClick={() => setActive(item.id)}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => setShutdownOpen(true)}
                tooltip="Encerrar servidor"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive active:bg-destructive/10 active:text-destructive"
              >
                <Power />
                <span>Encerrar Servidor</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-4 backdrop-blur-lg lg:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <span className="text-muted-foreground">Transcritor</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{activeItem.label}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="secondary" className="hidden sm:inline-flex">
              CUDA
            </Badge>
            <Badge variant="outline" className="hidden sm:inline-flex">
              Local only
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <span className="size-1.5 animate-pulse-soft rounded-full bg-primary" />
              pt-BR
            </Badge>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8">
          <div className="mx-auto w-full max-w-5xl">
            {active === "transcribe" && (
              <section className="flex flex-col gap-6">
                <div>
                  <h2 className="font-serif text-3xl text-foreground">
                    Transcrever Video
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Selecione um .mp4 do OBS e dispare a transcricao local.
                  </p>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileAudio className="size-5 text-muted-foreground" />
                      Enviar arquivo
                    </CardTitle>
                    <CardDescription>
                      O arquivo e processado na GPU local e removido apos a
                      transcricao.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-5">
                    <label
                      htmlFor="file-upload"
                      className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-muted/40 px-6 py-10 text-center transition-colors hover:border-primary/40 hover:bg-muted/70"
                    >
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-background text-primary shadow-sm">
                        <Upload className="size-5" />
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        Clique para selecionar um arquivo .mp4
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Gravacoes do OBS · processamento 100% local
                      </span>
                      <input
                        id="file-upload"
                        type="file"
                        accept="video/mp4"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null
                          setSelectedFile(file)
                          setDone(false)
                          setProgress(0)
                        }}
                      />
                    </label>

                    {selectedFile && (
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <FileAudio className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {selectedFile.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {(selectedFile.size / 1024 / 1024).toFixed(1)} MB
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setSelectedFile(null)}
                        >
                          <X />
                          <span className="sr-only">Remover arquivo</span>
                        </Button>
                      </div>
                    )}

                    <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                      <div className="flex flex-col">
                        <Label htmlFor="diarize" className="text-sm font-medium">
                          Separar participantes
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          Diarizacao por voz (pyannote)
                        </span>
                      </div>
                      <Switch
                        id="diarize"
                        checked={diarize}
                        onCheckedChange={setDiarize}
                      />
                    </div>

                    <Button
                      onClick={handleTranscribe}
                      disabled={!selectedFile || isTranscribing}
                      size="lg"
                      className="w-full"
                    >
                      {isTranscribing ? (
                        <>
                          <Loader2 className="animate-spin" />
                          Transcrevendo...
                        </>
                      ) : (
                        <>
                          <Sparkles />
                          Transcrever
                        </>
                      )}
                    </Button>

                    {(isTranscribing || done || progress > 0) && (
                      <>
                        <Separator />
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">
                              {progressLabel}
                            </span>
                            <span className="font-medium tabular-nums">
                              {Math.round(progress)}%
                            </span>
                          </div>
                          <Progress value={progress} />
                          {jobId && (
                            <p className="text-xs text-muted-foreground">
                              Job: {jobId}
                            </p>
                          )}
                        </div>
                      </>
                    )}

                    {done && (
                      <Alert>
                        <CheckCircle2 className="size-4" />
                        <AlertTitle>Finalizado!</AlertTitle>
                        <AlertDescription>
                          A transcricao foi salva e ja aparece na lista.
                        </AlertDescription>
                      </Alert>
                    )}
                    {jobError && (
                      <Alert variant="destructive">
                        <X className="size-4" />
                        <AlertTitle>Erro na transcricao</AlertTitle>
                        <AlertDescription>{jobError}</AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>
              </section>
            )}

            {active === "transcriptions" && (
              <section className="flex flex-col gap-6">
                <div>
                  <h2 className="font-serif text-3xl text-foreground">
                    Visualizar Transcricoes
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Filtre, ordene e abra o Markdown completo de cada transcricao.
                  </p>
                </div>

                <Card>
                  <CardContent className="flex flex-col gap-4 pt-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="relative w-full sm:max-w-xs">
                          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Buscar por arquivo ou cliente"
                            className="pl-9"
                          />
                        </div>
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
                          <SelectTrigger className="w-full sm:w-48">
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos os status</SelectItem>
                            {statusOptions.map((status) => (
                              <SelectItem key={status} value={status}>
                                {status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {hasActiveFilters && (
                          <Button
                            variant="ghost"
                            onClick={clearFilters}
                            className="text-muted-foreground"
                          >
                            <X />
                            Limpar
                          </Button>
                        )}
                      </div>
                      <Badge variant="outline" className="w-fit shrink-0 font-normal">
                        {displayedTranscriptions.length} de {transcriptions.length}
                      </Badge>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <SortableHeader
                              label="Arquivo"
                              field="name"
                              activeField={sortField}
                              direction={sortDir}
                              onSort={handleSort}
                            />
                            <SortableHeader
                              label="Data"
                              field="date"
                              activeField={sortField}
                              direction={sortDir}
                              onSort={handleSort}
                            />
                            <SortableHeader
                              label="Duracao"
                              field="duration"
                              activeField={sortField}
                              direction={sortDir}
                              onSort={handleSort}
                            />
                            <TableHead>Status</TableHead>
                            <TableHead className="w-[60px] text-right">Acao</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {transLoading ? (
                            Array.from({ length: 5 }).map((_, index) => (
                              <TableRow key={index}>
                                <TableCell>
                                  <Skeleton className="h-4 w-48" />
                                </TableCell>
                                <TableCell>
                                  <Skeleton className="h-4 w-32" />
                                </TableCell>
                                <TableCell>
                                  <Skeleton className="h-4 w-16" />
                                </TableCell>
                                <TableCell>
                                  <Skeleton className="h-5 w-20 rounded-full" />
                                </TableCell>
                                <TableCell className="text-right">
                                  <Skeleton className="ml-auto size-8 rounded-md" />
                                </TableCell>
                              </TableRow>
                            ))
                          ) : displayedTranscriptions.length === 0 ? (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={5} className="h-48">
                                <Empty>
                                  <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                      <FileText />
                                    </EmptyMedia>
                                    <EmptyTitle>
                                      {transcriptions.length === 0
                                        ? "Nenhuma transcricao ainda"
                                        : "Nenhum resultado"}
                                    </EmptyTitle>
                                    <EmptyDescription>
                                      {transcriptions.length === 0
                                        ? "Envie um .mp4 na aba Transcrever Video para comecar."
                                        : "Ajuste a busca ou os filtros aplicados."}
                                    </EmptyDescription>
                                  </EmptyHeader>
                                </Empty>
                              </TableCell>
                            </TableRow>
                          ) : (
                            displayedTranscriptions.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="font-medium">
                                  {item.fileName}
                                </TableCell>
                                <TableCell className="text-muted-foreground tabular-nums">
                                  {item.createdAt}
                                </TableCell>
                                <TableCell className="text-muted-foreground tabular-nums">
                                  {item.duration}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={statusVariant(item.status)}>
                                    {item.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                      >
                                        <MoreHorizontal />
                                        <span className="sr-only">Acoes</span>
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuLabel>Acoes</DropdownMenuLabel>
                                      <DropdownMenuGroup>
                                        <DropdownMenuItem
                                          onClick={() => setOpenTranscriptId(item.id)}
                                        >
                                          <Eye />
                                          Ver transcricao
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setRenameTarget(item)
                                            setRenameValue(item.fileName)
                                          }}
                                        >
                                          <Pencil />
                                          Renomear
                                        </DropdownMenuItem>
                                      </DropdownMenuGroup>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() =>
                                          setDeleteTarget({
                                            kind: "transcription",
                                            id: item.id,
                                            label: item.fileName,
                                          })
                                        }
                                      >
                                        <Trash2 />
                                        Deletar
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
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
              <section className="flex flex-col gap-6">
                <div>
                  <h2 className="font-serif text-3xl text-foreground">Criar ATA</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Escolha uma transcricao, refine o prompt e gere uma ATA.
                  </p>
                </div>

                <Card>
                  <CardContent className="flex flex-col gap-5 pt-6">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <Label>Transcricao</Label>
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
                      <div className="flex flex-col gap-2">
                        <Label>Provider LLM</Label>
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
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label>Modelo LLM</Label>
                      <Select value={ataModel} onValueChange={(value) => setAtaModel(value)}>
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

                    <div className="flex flex-col gap-2">
                      <Label htmlFor="ata-prompt">Prompt</Label>
                      <Textarea
                        id="ata-prompt"
                        rows={5}
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                      />
                    </div>

                    <Button
                      onClick={handleCreateAta}
                      disabled={!selectedTranscript || isCreatingAta}
                      size="lg"
                      className="w-full"
                    >
                      {isCreatingAta ? (
                        <>
                          <Loader2 className="animate-spin" />
                          Gerando ATA...
                        </>
                      ) : (
                        <>
                          <ClipboardCheck />
                          Criar ATA
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                {ataError && (
                  <Alert variant="destructive">
                    <X className="size-4" />
                    <AlertTitle>Erro ao gerar ATA</AlertTitle>
                    <AlertDescription>{ataError}</AlertDescription>
                  </Alert>
                )}

                {createdAtaContent && (
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle>ATA gerada</CardTitle>
                      {createdAtaId && (
                        <Badge variant="secondary" className="gap-1.5">
                          <CheckCircle2 className="size-3.5" />
                          Salva automaticamente
                        </Badge>
                      )}
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      <ScrollArea className="h-[500px] rounded-xl border border-border bg-card p-5">
                        <MarkdownViewer content={createdAtaContent} />
                      </ScrollArea>
                      {createdAtaId && (
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            setActive("atas")
                            setOpenAtaId(createdAtaId)
                          }}
                        >
                          <FileText />
                          Ver ATA em Visualizar ATAS
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )}
              </section>
            )}

            {active === "atas" && (
              <section className="flex flex-col gap-6">
                <div>
                  <h2 className="font-serif text-3xl text-foreground">
                    Visualizar ATAS
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Consulte todas as atas geradas e abra em Markdown.
                  </p>
                </div>

                <Card>
                  <CardContent className="flex flex-col gap-4 pt-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="relative w-full sm:max-w-xs">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={ataSearch}
                          onChange={(event) => setAtaSearch(event.target.value)}
                          placeholder="Buscar por titulo ou cliente"
                          className="pl-9"
                        />
                      </div>
                      <Badge variant="outline" className="w-fit shrink-0 font-normal">
                        {displayedAtas.length} de {atas.length}
                      </Badge>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableHead>Titulo</TableHead>
                            <TableHead>Transcricao</TableHead>
                            <TableHead>Data</TableHead>
                            <TableHead className="w-[60px] text-right">Acao</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {atasLoading ? (
                            Array.from({ length: 4 }).map((_, index) => (
                              <TableRow key={index}>
                                <TableCell>
                                  <Skeleton className="h-4 w-48" />
                                </TableCell>
                                <TableCell>
                                  <Skeleton className="h-4 w-40" />
                                </TableCell>
                                <TableCell>
                                  <Skeleton className="h-4 w-28" />
                                </TableCell>
                                <TableCell className="text-right">
                                  <Skeleton className="ml-auto size-8 rounded-md" />
                                </TableCell>
                              </TableRow>
                            ))
                          ) : displayedAtas.length === 0 ? (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={4} className="h-48">
                                <Empty>
                                  <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                      <ListChecks />
                                    </EmptyMedia>
                                    <EmptyTitle>
                                      {atas.length === 0
                                        ? "Nenhuma ATA ainda"
                                        : "Nenhum resultado"}
                                    </EmptyTitle>
                                    <EmptyDescription>
                                      {atas.length === 0
                                        ? "Gere uma ATA a partir de uma transcricao na aba Criar ATA."
                                        : "Ajuste a busca aplicada."}
                                    </EmptyDescription>
                                  </EmptyHeader>
                                </Empty>
                              </TableCell>
                            </TableRow>
                          ) : (
                            displayedAtas.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell className="font-medium">
                                  {item.title}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {item.sourceId}
                                </TableCell>
                                <TableCell className="text-muted-foreground tabular-nums">
                                  {item.createdAt}
                                </TableCell>
                                <TableCell className="text-right">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-8"
                                      >
                                        <MoreHorizontal />
                                        <span className="sr-only">Acoes</span>
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuLabel>Acoes</DropdownMenuLabel>
                                      <DropdownMenuGroup>
                                        <DropdownMenuItem
                                          onClick={() => setOpenAtaId(item.id)}
                                        >
                                          <Eye />
                                          Ver ATA
                                        </DropdownMenuItem>
                                      </DropdownMenuGroup>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onClick={() =>
                                          setDeleteTarget({
                                            kind: "ata",
                                            id: item.id,
                                            label: item.title,
                                          })
                                        }
                                      >
                                        <Trash2 />
                                        Deletar
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
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
              <section className="flex flex-col gap-6">
                <div>
                  <h2 className="font-serif text-3xl text-foreground">Por Cliente</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Filtre transcricoes e ATAs por cliente. Clique no cliente de um
                    item para atribuir.
                  </p>
                </div>

                <Card>
                  <CardContent className="flex flex-col gap-4 pt-6">
                    <div className="flex flex-col gap-2">
                      <Label>Filtrar por Cliente</Label>
                      <Select
                        value={selectedClientFilter || "__all__"}
                        onValueChange={(value) =>
                          setSelectedClientFilter(value === "__all__" ? "" : value)
                        }
                      >
                        <SelectTrigger className="sm:max-w-xs">
                          <SelectValue placeholder="Todos os clientes" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">Todos os clientes</SelectItem>
                          <SelectItem value="__unassigned__">
                            Sem cliente (nao indexados)
                          </SelectItem>
                          {clients.map((client) => (
                            <SelectItem key={client} value={client}>
                              {client}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {clients.length > 0 ? (
                        clients.map((client) => (
                          <Badge
                            key={client}
                            variant={
                              selectedClientFilter === client ? "default" : "outline"
                            }
                            className="cursor-pointer"
                            onClick={() =>
                              setSelectedClientFilter(
                                selectedClientFilter === client ? "" : client,
                              )
                            }
                          >
                            {client}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Nenhum cliente cadastrado ainda.
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Transcricoes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableHead>Arquivo</TableHead>
                            <TableHead>Data</TableHead>
                            <TableHead>Duracao</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead className="w-[60px] text-right">Acao</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredTranscriptions.length === 0 ? (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={5} className="h-32">
                                <span className="flex justify-center text-sm text-muted-foreground">
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
                                <TableCell className="text-muted-foreground tabular-nums">
                                  {item.createdAt}
                                </TableCell>
                                <TableCell className="text-muted-foreground tabular-nums">
                                  {item.duration}
                                </TableCell>
                                <TableCell>
                                  {editingClientId === item.id &&
                                  editingClientType === "transcription" ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        value={editingClientValue}
                                        onChange={(e) =>
                                          setEditingClientValue(e.target.value)
                                        }
                                        className="h-8 w-40"
                                        placeholder="Nome do cliente"
                                        list="client-suggestions"
                                        autoFocus
                                        onKeyDown={async (e) => {
                                          if (e.key === "Enter") {
                                            const success = await updateClient(
                                              item.id,
                                              "transcription",
                                              editingClientValue,
                                            )
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
                                          const success = await updateClient(
                                            item.id,
                                            "transcription",
                                            editingClientValue,
                                          )
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
                                        variant="ghost"
                                        onClick={() => {
                                          setEditingClientId(null)
                                          setEditingClientType(null)
                                        }}
                                      >
                                        Cancelar
                                      </Button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      className={cn(
                                        "rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted",
                                        !item.client && "italic text-muted-foreground",
                                      )}
                                      onClick={() => {
                                        setEditingClientId(item.id)
                                        setEditingClientType("transcription")
                                        setEditingClientValue(item.client || "")
                                      }}
                                    >
                                      {item.client || "Clique para atribuir"}
                                    </button>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => setOpenTranscriptId(item.id)}
                                  >
                                    <Eye />
                                    <span className="sr-only">Ver</span>
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

                <Card>
                  <CardHeader>
                    <CardTitle>ATAs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableHead>Titulo</TableHead>
                            <TableHead>Data</TableHead>
                            <TableHead>Cliente</TableHead>
                            <TableHead className="w-[60px] text-right">Acao</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredAtas.length === 0 ? (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={4} className="h-32">
                                <span className="flex justify-center text-sm text-muted-foreground">
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
                                <TableCell className="text-muted-foreground tabular-nums">
                                  {item.createdAt}
                                </TableCell>
                                <TableCell>
                                  {editingClientId === item.id &&
                                  editingClientType === "ata" ? (
                                    <div className="flex items-center gap-2">
                                      <Input
                                        value={editingClientValue}
                                        onChange={(e) =>
                                          setEditingClientValue(e.target.value)
                                        }
                                        className="h-8 w-40"
                                        placeholder="Nome do cliente"
                                        list="client-suggestions-ata"
                                        autoFocus
                                        onKeyDown={async (e) => {
                                          if (e.key === "Enter") {
                                            const success = await updateClient(
                                              item.id,
                                              "ata",
                                              editingClientValue,
                                            )
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
                                          const success = await updateClient(
                                            item.id,
                                            "ata",
                                            editingClientValue,
                                          )
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
                                        variant="ghost"
                                        onClick={() => {
                                          setEditingClientId(null)
                                          setEditingClientType(null)
                                        }}
                                      >
                                        Cancelar
                                      </Button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      className={cn(
                                        "rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted",
                                        !item.client && "italic text-muted-foreground",
                                      )}
                                      onClick={() => {
                                        setEditingClientId(item.id)
                                        setEditingClientType("ata")
                                        setEditingClientValue(item.client || "")
                                      }}
                                    >
                                      {item.client || "Clique para atribuir"}
                                    </button>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8"
                                    onClick={() => setOpenAtaId(item.id)}
                                  >
                                    <Eye />
                                    <span className="sr-only">Ver</span>
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
          </div>
        </main>
      </SidebarInset>

      {/* Visualizador de transcricao */}
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
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={!openTranscriptContent}
              onClick={() => copyMarkdown(openTranscriptContent)}
            >
              <Copy />
              Copiar Markdown
            </Button>
          </div>
          {openTranscriptContent ? (
            <ScrollArea className="max-h-[70vh] rounded-xl border border-border bg-card p-6">
              <MarkdownViewer content={openTranscriptContent} />
            </ScrollArea>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Carregando markdown...
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Visualizador de ATA */}
      <Dialog open={!!openAtaId} onOpenChange={(open) => !open && setOpenAtaId(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>ATA completa</DialogTitle>
            <DialogDescription className="sr-only">
              Visualizacao do conteudo da ATA em markdown
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={!openAtaContent}
              onClick={() => copyMarkdown(openAtaContent)}
            >
              <Copy />
              Copiar Markdown
            </Button>
          </div>
          {openAtaContent ? (
            <ScrollArea className="max-h-[70vh] rounded-xl border border-border bg-card p-6">
              <MarkdownViewer content={openAtaContent} />
            </ScrollArea>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Carregando markdown...
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Renomear transcricao */}
      <Dialog
        open={!!renameTarget}
        onOpenChange={(open) => !open && setRenameTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Renomear transcricao</DialogTitle>
            <DialogDescription>
              Defina um novo nome de exibicao para esta transcricao.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rename-input">Nome</Label>
            <Input
              id="rename-input"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitRename()
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              Cancelar
            </Button>
            <Button onClick={submitRename}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmacao de exclusao */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deletar {deleteTarget?.kind === "ata" ? "ATA" : "transcricao"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acao nao pode ser desfeita. "{deleteTarget?.label}" sera removido
              permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                confirmDelete()
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Deletar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmacao de encerramento do servidor */}
      <AlertDialog open={shutdownOpen} onOpenChange={setShutdownOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar o servidor?</AlertDialogTitle>
            <AlertDialogDescription>
              O motor local sera desligado e novas transcricoes nao poderao ser
              iniciadas ate reabrir o aplicativo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                handleShutdown()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <Power />
              Encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster richColors position="bottom-right" />
    </SidebarProvider>
  )
}

export default App
