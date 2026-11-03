import { ArrowUpIcon } from "@solar-icons/react/linear/arrow-up"
import { CloseCircleIcon as CloseIcon } from "@solar-icons/react/linear/close-circle"
import { StopIcon as SquareIcon } from "@solar-icons/react/linear/stop"
import { cn } from "cn"
import type * as React from "react"
import { useLayoutEffect, useRef, useState } from "react"
import { additionalModels, defaultModels } from "@/components/ai/model-options"
import { type ModelEffort, type ModelOption, ModelPicker } from "@/components/ai/model-picker"
import { type PromptTool, PromptToolsMenu, promptTools } from "@/components/ai/prompt-tools-menu"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface PromptInputProps extends Omit<React.ComponentProps<"form">, "onSubmit"> {
  defaultValue?: string
  model?: string
  models?: ModelOption[]
  moreModels?: ModelOption[]
  onModelChange?: (model: string) => void
  effort?: ModelEffort
  onEffortChange?: (effort: ModelEffort) => void
  onSubmit?: (
    value: string,
    selection: { model: string; effort: ModelEffort; tool?: PromptTool; files: File[] },
  ) => void
  onToolSelect?: (tool: PromptTool) => void
  onFilesChange?: (files: File[]) => void
  pending?: boolean
  placeholder?: string
  // Axe AI: controlled text; the parent clears it after a send.
  value?: string
  onValueChange?: (value: string) => void
  // Axe AI: called by the stop button while `pending`.
  onStop?: () => void
  // Axe AI: overrides "has text and not pending" (attachments-only sends, queueing while pending).
  canSubmit?: boolean
  // Axe AI: a spinner in the send button while the text is being checked (Watching validates a target).
  checking?: boolean
  // Axe AI: accessible names for the send and stop button.
  submitLabel?: string
  stopLabel?: string
  // Axe AI: content above the text box (attachments, notices, a recorder).
  header?: React.ReactNode
  // Axe AI: replaces the tools menu and model picker on the left of the control row.
  toolbar?: React.ReactNode
  // Axe AI: extra controls just before the send button.
  actions?: React.ReactNode
  // Axe AI: one row, like the desktop app's: leading control, text, actions; send shows only when it can act.
  // The toolbar is drawn by the parent under the box.
  inline?: boolean
  leading?: React.ReactNode
  // Axe AI: access to the text box and extra props for it (merged class, paste, max length).
  textareaRef?: React.Ref<HTMLTextAreaElement>
  textareaProps?: Omit<React.ComponentProps<"textarea">, "value" | "onChange" | "onKeyDown" | "ref">
}

// Eight 22.5px lines (1.5rem on the 15px root) plus the padding.
const MAX_HEIGHT = 192

const chipEnterClass =
  "transition-[opacity,scale,background-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] starting:scale-95 starting:opacity-0 motion-reduce:starting:scale-100"

function PromptInput({
  className,
  defaultValue = "",
  model,
  models = defaultModels,
  moreModels = additionalModels,
  onModelChange,
  effort,
  onEffortChange,
  onSubmit,
  onToolSelect,
  onFilesChange,
  pending = false,
  placeholder = "Ask anything…",
  value: controlledValue,
  onValueChange,
  onStop,
  canSubmit,
  checking = false,
  submitLabel = "Send message",
  stopLabel = "Stop response",
  header,
  toolbar,
  actions,
  inline = false,
  leading,
  textareaRef: externalTextareaRef,
  textareaProps,
  ...props
}: PromptInputProps) {
  const [internalValue, setInternalValue] = useState(defaultValue)
  const value = controlledValue ?? internalValue
  const [selectedTool, setSelectedTool] = useState<PromptTool>()
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [internalModel, setInternalModel] = useState(models.find((item) => !item.requiresUpgrade)?.id ?? "")
  const [internalEffort, setInternalEffort] = useState<ModelEffort>("medium")
  const selectedModel = model ?? internalModel
  const selectedEffort = effort ?? internalEffort
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendable = canSubmit ?? (value.trim().length > 0 && !pending)

  // Axe AI: the box grows with the text up to eight lines, then scrolls with its scrollbar hidden.
  function resizeTextarea(element: HTMLTextAreaElement) {
    element.style.height = "0px"
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`
    element.style.overflowY = element.scrollHeight > MAX_HEIGHT ? "auto" : "hidden"
  }

  // Axe AI: re-measure when a controlled value changes from outside (cleared, dictation added).
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (controlledValue === undefined || !element) return
    resizeTextarea(element)
  }, [controlledValue])

  function setValue(next: string) {
    if (controlledValue === undefined) setInternalValue(next)
    onValueChange?.(next)
  }

  function submitPrompt() {
    const prompt = value.trim()
    if (!sendable) return
    onSubmit?.(prompt, { model: selectedModel, effort: selectedEffort, tool: selectedTool, files })
    setFiles([])
    onFilesChange?.([])
    if (controlledValue !== undefined) return
    setInternalValue("")
    if (textareaRef.current) textareaRef.current.style.height = "0px"
  }

  const textArea = (
    <Textarea
      aria-label="Message"
      onChange={(event) => {
        setValue(event.target.value)
        resizeTextarea(event.target)
      }}
      onKeyDown={(event) => {
        // Axe AI: don't send while an IME is composing (Japanese, Chinese, Korean input).
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          submitPrompt()
        }
      }}
      placeholder={placeholder}
      rows={1}
      {...textareaProps}
      ref={(node) => {
        textareaRef.current = node
        if (typeof externalTextareaRef === "function") externalTextareaRef(node)
        else if (externalTextareaRef) externalTextareaRef.current = node
      }}
      className={cn(
        "no-scrollbar min-h-18 resize-none overflow-y-hidden rounded-md border-0 bg-transparent py-1.5 pr-0 pl-2 text-[16px]/6 font-normal tracking-normal shadow-none placeholder:truncate placeholder:font-normal placeholder:text-ink-3 focus-visible:ring-0 md:text-[16px]/6 dark:bg-transparent",
        textareaProps?.className,
      )}
      value={value}
    />
  )
  const sendButton = (
    <Button
      aria-label={pending ? stopLabel : submitLabel}
      className={cn(
        "size-[34px] rounded-full border-0 shadow-none hover:brightness-110 dark:bg-none",
        pending ? "bg-primary text-primary-foreground" : "bg-brand text-white",
      )}
      variant="default"
      disabled={checking || (!pending && !sendable)}
      size="icon-lg"
      type={pending ? "button" : "submit"}
      onClick={pending ? onStop : undefined}
    >
      <span className="grid *:col-start-1 *:row-start-1 *:transition-[opacity,scale] *:duration-150 *:ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:*:transition-opacity">
        {checking ? (
          <span aria-hidden="true" className="block size-[14px] place-self-center animate-spin rounded-full border-[1.5px] border-white/40 border-t-white motion-reduce:animate-none" />
        ) : (
          <ArrowUpIcon
            aria-hidden="true"
            className={cn("place-self-center", pending && "scale-75 opacity-0")}
          />
        )}
        <SquareIcon
          aria-hidden="true"
          className={cn("size-2.5 place-self-center fill-current", !pending && "scale-75 opacity-0")}
        />
      </span>
    </Button>
  )

  return (
    <form
      data-slot="prompt-input"
      // Axe AI: the flat kit (2026-10-26); in light an edge and a soft lift so it stands off the page (--composer-edge).
      className={cn(
        "w-full rounded-[22px] border-0 bg-composer p-[8px] shadow-[var(--composer-edge)]",
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault()
        submitPrompt()
      }}
      {...props}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label="Upload files"
        onChange={(event) => {
          const next = [...files, ...Array.from(event.target.files ?? [])]
          setFiles(next)
          onFilesChange?.(next)
          event.target.value = ""
        }}
      />
      {(files.length > 0 || selectedTool) && (
        <div className="flex flex-wrap gap-2 px-2 py-1">
          {selectedTool && (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              className={chipEnterClass}
              onClick={() => setSelectedTool(undefined)}
              aria-label="Clear selected tool"
            >
              {promptTools.find((tool) => tool.id === selectedTool)?.label}
              <CloseIcon />
            </Button>
          )}
          {files.map((file, index) => (
            <Button
              // biome-ignore lint/suspicious/noArrayIndexKey: files may share names; no stable id available
              key={`${file.name}-${index}`}
              type="button"
              variant="secondary"
              size="xs"
              className={cn("max-w-48", chipEnterClass)}
              aria-label={`Remove ${file.name}`}
              onClick={() => {
                const next = files.filter((_, fileIndex) => fileIndex !== index)
                setFiles(next)
                onFilesChange?.(next)
              }}
            >
              <span className="truncate">{file.name}</span>
              <CloseIcon />
            </Button>
          ))}
        </div>
      )}
      {header}
      {inline ? (
        <div className="flex items-end gap-[6px] pr-[2px]">
          {leading}
          <div className="min-w-0 flex-1">{textArea}</div>
          {actions}
          {(pending || sendable || checking) && sendButton}
        </div>
      ) : (
        textArea
      )}
      {!inline && (
        <div className="flex items-center justify-between gap-2 pt-2">
          {toolbar ?? (
            <div className="flex items-center gap-1">
              <PromptToolsMenu
                onSelect={(tool) => {
                  if (tool === "files") fileInputRef.current?.click()
                  else setSelectedTool(tool)
                  onToolSelect?.(tool)
                }}
              />
              <ModelPicker
                models={models}
                moreModels={moreModels}
                value={selectedModel}
                effort={selectedEffort}
                onValueChange={(next) => {
                  if (model === undefined) setInternalModel(next)
                  onModelChange?.(next)
                }}
                onEffortChange={(next) => {
                  if (effort === undefined) setInternalEffort(next)
                  onEffortChange?.(next)
                }}
              />
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {sendButton}
          </div>
        </div>
      )}
    </form>
  )
}

export type { PromptInputProps }
export { PromptInput }
