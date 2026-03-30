export const layerColorOptions = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Yellow', value: '#facc15' },
  { name: 'Cyan', value: '#22d3ee' },
  { name: 'Neon Green', value: '#39ff14' },
  { name: 'Neon Pink', value: '#ff4fd8' },
  { name: 'Orange', value: '#fb923c' },
  { name: 'Violet', value: '#a855f7' },
] as const

export const defaultLayerColors = layerColorOptions.map((option) => option.value)
