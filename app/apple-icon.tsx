import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'white',
        }}
      >
        <svg
          viewBox="0 0 100 100"
          width="150"
          height="150"
          fill="none"
          stroke="#217FC7"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M34,14 H30 A8,8 0 0 0 22,22 V42 A8,8 0 0 1 14,50 A8,8 0 0 1 22,58 V78 A8,8 0 0 0 30,86 H34" />
          <path d="M66,86 H70 A8,8 0 0 0 78,78 V58 A8,8 0 0 1 86,50 A8,8 0 0 1 78,42 V22 A8,8 0 0 0 70,14 H66" />
        </svg>
      </div>
    ),
    { ...size }
  )
}
