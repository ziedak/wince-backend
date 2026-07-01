import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type SVGProps,
} from 'react'
import { Root as Radio, Item } from '@radix-ui/react-radio-group'
import { CircleCheck, RotateCcw } from 'lucide-react'
import { cn } from '@/utils/utils'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useSidebar } from '../ui/sidebar'

export type DrawerTriggerComponent = React.ComponentType
export type DrawerProps = {
  trigger: DrawerTriggerComponent
  /** The content to be displayed inside the drawer. */
  children: React.ReactNode
}
export function Drawer({ trigger: Trigger, children }: DrawerProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Trigger />
      </SheetTrigger>
      <SheetContent className='flex flex-col'>{children}</SheetContent>
    </Sheet>
  )
}

export function DrawerIconTrigger({
  triggerIcon: TriggerIcon,
  ariaLabel,
}: {
  triggerIcon: React.ComponentType<SVGProps<SVGSVGElement>>
  ariaLabel?: string
}) {
  const { setOpen } = useSidebar()

  return (
    <Button
      size='icon'
      variant='ghost'
      aria-label={ariaLabel}
      className='rounded-full'
      onClick={() => setOpen(true)}
    >
      <TriggerIcon aria-hidden='true' />
    </Button>
  )
}
export function DrawerElementTrigger({
  triggerElement,
}: {
  triggerElement: React.ReactNode
}) {
  const { setOpen } = useSidebar()

  return (
    <button
      type='button'
      onClick={() => {
        setOpen(true)
      }}
      className='cursor-pointer'
    >
      {triggerElement}
    </button>
  )
}
export type DrawerTitleProps = {
  /** The title of the drawer, displayed at the top. */
  title: string
  /** A brief description or subtitle for the drawer. */
  description?: string
}
export const DrawerTitle = ({ title, description }: DrawerTitleProps) => {
  return (
    <SheetHeader className='pb-0 text-start'>
      <SheetTitle>{title}</SheetTitle>
      {description && <SheetDescription>{description}</SheetDescription>}
    </SheetHeader>
  )
}

export const DrawerFooter = ({ children }: { children: React.ReactNode }) => {
  return <SheetFooter className='gap-2'>{children}</SheetFooter>
}

export const DrawerMain = ({ children }: { children: React.ReactNode }) => {
  return <div className='flex-1 px-4 space-y-6 overflow-y-auto'>{children}</div>
}

export type SectionTitleProps = {
  title: string
  showReset?: boolean
  onReset?: () => void
  resetAriaLabel?: string
  className?: string
}
export function SectionTitle({
  title,
  showReset = false,
  onReset,
  resetAriaLabel,
  className,
}: SectionTitleProps) {
  return (
    <div
      className={cn(
        'mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground',
        className
      )}
    >
      {title}
      {showReset && onReset && (
        <Button
          type='button'
          size='icon'
          variant='secondary'
          className='rounded-full size-4'
          onClick={onReset}
          aria-label={resetAriaLabel}
        >
          <RotateCcw className='size-3' />
        </Button>
      )}
    </div>
  )
}

export type RadioItemProps = {
  label: string
  value: string
  icon: React.ComponentType<SVGProps<SVGSVGElement>>
}

function RadioItem({ value, label, icon: Icon }: RadioItemProps) {
  return (
    <Item
      value={value}
      className={cn('group outline-none', 'transition duration-200 ease-in')}
      aria-label={`Select ${label.toLowerCase()}`}
      aria-describedby={`${value}-description`}
    >
      <div
        className={cn(
          'relative rounded-md ring-1 ring-border',
          'group-data-[state=checked]:shadow-2xl group-data-[state=checked]:ring-primary',
          'group-focus-visible:ring-2'
        )}
        aria-label={`${label} option preview`}
      >
        <CircleCheck
          className={cn(
            'size-6 fill-primary stroke-white',
            'group-data-[state=unchecked]:hidden',
            'absolute top-0 right-0 translate-x-1/2 -translate-y-1/2'
          )}
          aria-hidden='true'
        />
        <Icon aria-hidden='true' />
      </div>
      <div className='mt-1 text-xs' id={`${value}-description`}>
        {label}
      </div>
    </Item>
  )
}

export type RadioGroupItemProps = {
  header: SectionTitleProps
  items: RadioItemProps[]
  defaultValue?: string
  onValueChange?: (value: string) => void
}
export function RadioGroupItem({
  header,
  items,
  defaultValue,
  onValueChange,
}: RadioGroupItemProps) {
  const initialValue = defaultValue ?? items.at(0)?.value ?? ''
  const [currentValue, setCurrentValue] = useState(initialValue)

  useEffect(() => {
    setCurrentValue(initialValue)
  }, [initialValue])

  if (!items.length) return null
  return (
    <div className='overflow-x-auto'>
      <SectionTitle
        title={header.title}
        showReset={currentValue !== defaultValue}
        onReset={() => {
          const value = defaultValue ?? items[0]?.value
          if (!value) return
          setCurrentValue(value)
          onValueChange?.(value)
        }}
        resetAriaLabel='Reset theme preference to default'
      />
      <Radio
        value={currentValue}
        onValueChange={(value) => {
          setCurrentValue(value)
          onValueChange?.(value)
        }}
        className='grid w-full max-w-md grid-cols-3 gap-4'
        aria-label='Select theme preference'
        aria-describedby='theme-description'
      >
        {items.map((item) => (
          <RadioItem key={item.value} {...item} />
        ))}
      </Radio>
    </div>
  )
}
//-----------------------------

type Context = {
  show(content: string): void
}

const DrawerContext = createContext<Context | undefined>(undefined)

export function useDrawer() {
  const ctx = useContext(DrawerContext)

  if (!ctx) throw new Error()

  return ctx
}

export function DrawerController({
  children,
  render,
}: {
  children: React.ReactNode

  render(key: string): React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  const [current, setCurrent] = useState<string | null>(null)

  const pending = useRef<string | null>(null)

  function show(next: string) {
    if (!open) {
      setCurrent(next)
      setOpen(true)
      return
    }

    if (current === next) {
      return
    }

    pending.current = next

    setOpen(false)
  }

  return (
    <DrawerContext.Provider
      value={{
        show,
      }}
    >
      {children}

      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next && pending.current) {
            const target = pending.current

            pending.current = null

            setCurrent(target)

            setTimeout(() => setOpen(true), 220)

            return
          }

          setOpen(next)
        }}
      >
        <SheetContent>{current && render(current)}</SheetContent>
      </Sheet>
    </DrawerContext.Provider>
  )
}

export function DrawerTrigger({
  target,
  children,
}: {
  target: string
  children: React.ReactNode
}) {
  const { show } = useDrawer()

  return <div onClick={() => show(target)}>{children}</div>
}

// usage: 
// <DrawerController
//   render={(page) => {
//     switch (page) {
//       case 'profile':
//         return <div>Profile Drawer Content</div>

//       case 'theme':
//         return <div>Theme Drawer Content</div>

//       case 'settings':
//         return <div>Settings Drawer Content</div>
//       default:
//         return null
//     }
//   }}
// >
//   {/* <SidebarMenu> */}
//   <DrawerTrigger target='profile'>Profil</DrawerTrigger>
//   <DrawerTrigger target='theme'>Theme</DrawerTrigger>
//   <DrawerTrigger target='settings'>Settings</DrawerTrigger>
//   {/* </SidebarMenu> */}
// </DrawerController>
