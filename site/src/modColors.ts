export interface ModPalette {
  badge: string;        // badge classes: bg-X text-X
  activeBg: string;     // active-state background
  activeBorder: string; // active-state border
  activeText: string;   // active-state text
}

const PALETTES: Record<string, ModPalette> = {
  vanilla:        { badge: 'bg-slate-700 text-slate-300',    activeBg: 'bg-slate-600',    activeBorder: 'border-slate-400',   activeText: 'text-white'         },
  innawood:       { badge: 'bg-emerald-900 text-emerald-300', activeBg: 'bg-emerald-900',  activeBorder: 'border-emerald-600', activeText: 'text-emerald-200'   },
  magiclysm:      { badge: 'bg-violet-900 text-violet-300',   activeBg: 'bg-violet-900',   activeBorder: 'border-violet-600',  activeText: 'text-violet-200'    },
  aftershock:     { badge: 'bg-orange-900 text-orange-300',   activeBg: 'bg-orange-900',   activeBorder: 'border-orange-600',  activeText: 'text-orange-200'    },
  xedra:          { badge: 'bg-cyan-900 text-cyan-300',       activeBg: 'bg-cyan-900',     activeBorder: 'border-cyan-600',    activeText: 'text-cyan-200'      },
  mindovermatter: { badge: 'bg-pink-900 text-pink-300',       activeBg: 'bg-pink-900',     activeBorder: 'border-pink-600',    activeText: 'text-pink-200'      },
};

const FALLBACK: ModPalette = {
  badge: 'bg-slate-700 text-slate-300',
  activeBg: 'bg-slate-600',
  activeBorder: 'border-slate-400',
  activeText: 'text-white',
};

export function getModPalette(modId: string): ModPalette {
  return PALETTES[modId] ?? FALLBACK;
}
