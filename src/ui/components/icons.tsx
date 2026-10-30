// The template's inline SVG icons plus two app icons (no icon library, constitution I.5).
const paths = {
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  expand: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  settings: 'M19.14 12.94a7.49 7.49 0 0 0 .05-.94 7.49 7.49 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.49.49 0 0 0 13.9 2h-3.84a.49.49 0 0 0-.49.42l-.36 2.54a7.36 7.36 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.67 8.48a.49.49 0 0 0 .12.64l2.03 1.58a7.6 7.6 0 0 0 0 1.88L2.79 14.16a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54a.49.49 0 0 0 .49.42h3.84a.49.49 0 0 0 .49-.42l.36-2.54a7.03 7.03 0 0 0 1.62-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5z',
}

export type IconName = keyof typeof paths

export function Icon({ name, class: className = 'icon' }: { name: IconName; class?: string }) {
  return (
    <span class={className} aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
    </span>
  )
}
