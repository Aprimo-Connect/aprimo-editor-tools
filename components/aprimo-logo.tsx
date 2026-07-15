export function AprimoLogo() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/aprimo_editor_tools.png"
        alt="Aprimo Editor Tools"
        height={61}
        className="block dark:hidden"
        style={{ height: 61, width: 'auto' }}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/aprimo_editor_tools_dark.png"
        alt="Aprimo Editor Tools"
        height={61}
        className="hidden dark:block"
        style={{ height: 61, width: 'auto' }}
      />
    </>
  )
}
