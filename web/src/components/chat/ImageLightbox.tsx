import { Copy, Download, X } from 'lucide-react'
import { Button } from '@/components/ui'

interface ImageLightboxProps {
  src?: string
  alt?: string
  onClose: () => void
}

export default function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  if (!src) return null

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `image-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      window.open(src, '_blank')
    }
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    } catch {
      navigator.clipboard.writeText(src)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/90 p-6" onClick={onClose}>
      <div className="absolute right-6 top-5 z-10 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" onClick={handleCopy}>
          <Copy size={12} /> Copy
        </Button>
        <Button size="sm" onClick={handleDownload}>
          <Download size={12} /> Download
        </Button>
        <Button size="sm" onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      <img src={src} alt={alt ?? 'Full preview'} onClick={(e) => e.stopPropagation()} className="max-h-[85vh] max-w-[90vw] rounded-md object-contain" />
    </div>
  )
}
