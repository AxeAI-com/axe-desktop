import { Menu } from "@base-ui/react/menu"
import { AltArrowDownIcon as ChevronDownIcon } from "@solar-icons/react/linear/alt-arrow-down"
import { AltArrowRightIcon as ChevronRightIcon } from "@solar-icons/react/linear/alt-arrow-right"
import { CheckReadIcon as CheckIcon } from "@solar-icons/react/linear/check-read"
import { cn } from "cn"
import { type ReactNode, useState } from "react"
import { Button } from "@/components/ui/button"

interface ModelOption {
  description?: string
  provider?: "openai" | "claude"
  family?: string
  id: string
  name: string
  price?: string
  badge?: string
  requiresUpgrade?: boolean
  // Axe AI: extra words the search matches (provider, id).
  keywords?: string
  // Axe AI: tints the price line (e.g. a free model used up for today).
  priceTone?: "warning"
  // Axe AI: a logo image for the model's maker (any provider, not just openai/claude).
  logo?: string
}

type ModelEffort = "low" | "medium" | "high" | "extra"

interface ModelPickerProps {
  className?: string
  defaultValue?: string
  models: ModelOption[]
  moreModels?: ModelOption[]
  onValueChange?: (value: string) => void
  value?: string
  effort?: ModelEffort
  defaultEffort?: ModelEffort
  onEffortChange?: (effort: ModelEffort) => void
  onUpgrade?: (modelId: string) => void
  // Axe AI: the locked rows' button text (default "Upgrade").
  upgradeLabel?: string
  footer?: ReactNode
  // Axe AI: controlled open state (errors open the picker to suggest another model).
  open?: boolean
  onOpenChange?: (open: boolean) => void
  // Axe AI: hides the effort submenu and label (effort has its own control in Axe AI).
  showEffort?: boolean
  // Axe AI: accessible name and extra content for the trigger, and text when nothing is selected.
  triggerLabel?: string
  triggerExtra?: ReactNode
  placeholder?: ReactNode
  // Axe AI: a search box over every model; `moreModels` then shows as a labelled group, not a submenu.
  search?: { label: string; placeholder?: string; empty: ReactNode; moreLabel?: string; modelsLabel?: string }
  // Axe AI: where the menu opens (a composer at the bottom of the page opens it upwards).
  side?: "top" | "bottom"
  align?: "start" | "end"
}

const surface =
  "w-80 max-h-[var(--available-height)] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[1rem] bg-card p-1.5 font-sans text-sm font-[450] tracking-[-0.05px] text-muted-foreground shadow-card outline-none origin-(--transform-origin) transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-opacity"
const row =
  "flex w-full cursor-pointer items-center gap-3 rounded-[0.625rem] px-3 py-2 text-left outline-none data-highlighted:bg-muted data-disabled:cursor-default data-disabled:opacity-50"
const effortLabels: Record<ModelEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  extra: "Extra",
}

function ModelProviderIcon({ provider, logo }: { provider?: ModelOption["provider"]; logo?: string }) {
  // Axe AI: any maker's logo.
  if (logo)
    return (
      <img
        src={logo}
        alt=""
        className={cn("size-4 shrink-0 rounded-[0.25rem]", /(openai|grok)\.svg$/.test(logo) && "dark:invert")}
      />
    )
  if (!provider) return null
  if (provider === "claude")
    return <img src="/icons/providers/claude.svg" alt="" className="size-4 shrink-0" />
  return (
    <span aria-hidden="true" className="size-4 shrink-0">
      <img src="/icons/providers/openai.svg" alt="" className="size-4 scale-150 dark:hidden" />
      <img src="/icons/providers/openai-dark.svg" alt="" className="hidden size-4 scale-150 dark:block" />
    </span>
  )
}

function ModelPicker({
  className,
  defaultValue,
  models,
  moreModels = [],
  onValueChange,
  value,
  effort,
  defaultEffort = "medium",
  onEffortChange,
  onUpgrade,
  upgradeLabel = "Upgrade",
  footer,
  open,
  onOpenChange,
  showEffort = true,
  triggerLabel,
  triggerExtra,
  placeholder = "Select model",
  search,
  side = "bottom",
  align = "end",
}: ModelPickerProps) {
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? models.find((model) => !model.requiresUpgrade)?.id ?? "",
  )
  const [internalEffort, setInternalEffort] = useState(defaultEffort)
  const selectedValue = value ?? internalValue
  const selectedEffort = effort ?? internalEffort
  const selectedModel = [...models, ...moreModels].find((model) => model.id === selectedValue)

  function selectModel(id: string) {
    if (value === undefined) setInternalValue(id)
    onValueChange?.(id)
  }

  function modelRows(items: ModelOption[]) {
    return items.map((model) => {
      // Axe AI: search matches the name, badge, description and keywords.
      const label = [model.name, model.badge, model.description, model.keywords].filter(Boolean).join(" ")
      const content = (
        <>
          <ModelProviderIcon provider={model.provider} logo={model.logo} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2 text-sm">
              {model.name}
              {(model.badge || model.family) && (
                <span className="rounded-sm bg-muted px-1.5 text-xs leading-5">
                  {model.badge ?? model.family}
                </span>
              )}
            </span>
            {model.description && <span className="mt-0.5 block text-xs leading-5">{model.description}</span>}
          </span>
        </>
      )
      return model.requiresUpgrade ? (
        <Menu.Item
          className={row}
          key={model.id}
          label={label}
          disabled={!onUpgrade}
          onClick={() => onUpgrade?.(model.id)}
        >
          {content}
          <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-xs leading-4 text-primary-foreground dark:bg-none">
            {upgradeLabel}
          </span>
        </Menu.Item>
      ) : (
        <Menu.RadioItem className={row} key={model.id} value={model.id} label={label} closeOnClick>
          {content}
          {model.price && (
            <span
              className={cn(
                "shrink-0 text-right text-xs",
                model.priceTone === "warning" && "text-amber-600 dark:text-amber-400",
              )}
            >
              {model.price}
            </span>
          )}
          <Menu.RadioItemIndicator className="ml-auto shrink-0">
            <CheckIcon className="size-4" />
          </Menu.RadioItemIndicator>
        </Menu.RadioItem>
      )
    })
  }

  const groupLabel = "px-3 pt-2 pb-1 text-xs leading-5 text-muted-foreground/80"
  const root = (
    <Menu.Root open={open} onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}>
      <Menu.Trigger
        aria-label={triggerLabel}
        // Axe AI: Pasta's data-slot convention, so tests and styles can find the picker.
        data-slot="model-picker"
        render={
          <Button
            className={cn(
              "h-8 gap-2 rounded-full px-3 text-sm font-[450] tracking-[-0.05px] text-muted-foreground",
              className,
            )}
            variant="ghost"
          />
        }
      >
        <ModelProviderIcon provider={selectedModel?.provider} logo={selectedModel?.logo} />
        <span className="max-w-40 truncate">{selectedModel?.name ?? placeholder}</span>
        {triggerExtra}
        {showEffort && <span className="text-muted-foreground/80">{effortLabels[selectedEffort]}</span>}
        <ChevronDownIcon className="size-3.5 transition-[rotate] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] in-data-popup-open:rotate-180" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side={side} align={align} sideOffset={8} collisionPadding={12} className="z-50">
          <Menu.Popup className={surface} data-slot="model-picker-menu">
            {search ? (
              <>
                <Menu.Input
                  aria-label={search.label}
                  placeholder={search.placeholder}
                  className="mb-1 h-9 w-full rounded-[0.625rem] bg-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <Menu.Empty className="px-3 py-6 text-center text-sm">{search.empty}</Menu.Empty>
                <Menu.List>
                  <Menu.RadioGroup data-filter-section value={selectedValue} onValueChange={selectModel}>
                    {search.modelsLabel && (
                      <Menu.GroupLabel className={groupLabel}>{search.modelsLabel}</Menu.GroupLabel>
                    )}
                    {modelRows(models)}
                  </Menu.RadioGroup>
                  {moreModels.length > 0 && (
                    <Menu.RadioGroup data-filter-section value={selectedValue} onValueChange={selectModel}>
                      <Menu.GroupLabel className={groupLabel}>
                        {search.moreLabel ?? "More models"}
                      </Menu.GroupLabel>
                      {modelRows(moreModels)}
                    </Menu.RadioGroup>
                  )}
                </Menu.List>
              </>
            ) : (
              <Menu.RadioGroup value={selectedValue} onValueChange={selectModel}>
                {modelRows(models)}
              </Menu.RadioGroup>
            )}
            {showEffort && (
              <>
                <Menu.Separator className="mx-3 my-1 h-px bg-border/60" />
                <Menu.SubmenuRoot>
                  <Menu.SubmenuTrigger className={row}>
                    Effort <span className="ml-auto text-xs">{effortLabels[selectedEffort]}</span>
                    <ChevronRightIcon className="size-3.5" />
                  </Menu.SubmenuTrigger>
                  <Menu.Portal>
                    <Menu.Positioner side="right" align="start" sideOffset={6} className="z-50">
                      <Menu.Popup className={cn(surface, "w-64")}>
                        <p className="px-3 py-2 text-xs leading-5">
                          Higher effort gives the model more time to work through complex tasks.
                        </p>
                        <Menu.RadioGroup
                          value={selectedEffort}
                          onValueChange={(next: ModelEffort) => {
                            if (effort === undefined) setInternalEffort(next)
                            onEffortChange?.(next)
                          }}
                        >
                          {(Object.keys(effortLabels) as ModelEffort[]).map((level) => (
                            <Menu.RadioItem className={row} key={level} value={level}>
                              {effortLabels[level]}
                              <Menu.RadioItemIndicator className="ml-auto">
                                <CheckIcon className="size-4" />
                              </Menu.RadioItemIndicator>
                            </Menu.RadioItem>
                          ))}
                        </Menu.RadioGroup>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.SubmenuRoot>
              </>
            )}
            {!search && moreModels.length > 0 && (
              <>
                <Menu.Separator className="mx-3 my-1 h-px bg-border/60" />
                <Menu.SubmenuRoot>
                  <Menu.SubmenuTrigger className={row}>
                    More models
                    <ChevronRightIcon className="ml-auto size-3.5" />
                  </Menu.SubmenuTrigger>
                  <Menu.Portal>
                    <Menu.Positioner side="right" align="start" sideOffset={6} className="z-50">
                      <Menu.Popup className={surface}>
                        <Menu.RadioGroup value={selectedValue} onValueChange={selectModel}>
                          {modelRows(moreModels)}
                        </Menu.RadioGroup>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.SubmenuRoot>
              </>
            )}
            {footer && (
              <>
                <Menu.Separator className="mx-3 my-1 h-px bg-border/60" />
                <div className="px-3 py-2 text-xs leading-5">{footer}</div>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
  return search ? <Menu.FilterProvider>{root}</Menu.FilterProvider> : root
}

export type { ModelEffort, ModelOption, ModelPickerProps }
export { ModelPicker }
