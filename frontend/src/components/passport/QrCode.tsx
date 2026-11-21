import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

/** QR drawn in the browser; always dark on white so phone cameras can read it in dark mode. */
export function QrCode({ value, size = 112, label }: { value: string; size?: number; label: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' })
      .then((u) => live && setSrc(u))
      .catch(() => live && setSrc(''))
    return () => {
      live = false
    }
  }, [value, size])
  if (!src) return <div style={{ width: size, height: size }} className="rounded-lg bg-muted" />
  return <img src={src} width={size} height={size} alt={label} className="rounded-lg bg-white p-1" />
}
