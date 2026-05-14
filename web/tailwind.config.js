import defaultTheme from "tailwindcss/defaultTheme"
import animate from "tailwindcss-animate"
import typography from "@tailwindcss/typography"

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
  	container: {
  		center: true,
  		padding: '2rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			}
  		},
  		fontFamily: {
  			sans: [
  				'var(--font-sans)',
                    ...defaultTheme.fontFamily.sans
                ],
  			serif: [
  				'var(--font-serif)',
                    ...defaultTheme.fontFamily.serif
                ]
  		},
  		boxShadow: {
  			glow: '0 0 0 1px hsl(var(--ring)) inset, 0 8px 30px -12px hsl(var(--ring))'
  		},
  		keyframes: {
  			'pulse-soft': {
  				'0%, 100%': {
  					opacity: '0.35'
  				},
  				'50%': {
  					opacity: '0.8'
  				}
  			},
  			'stamp-in': {
  				'0%': {
  					transform: 'scale(0.7) rotate(-6deg)',
  					opacity: '0'
  				},
  				'100%': {
  					transform: 'scale(1) rotate(0deg)',
  					opacity: '1'
  				}
  			},
  			'line-reveal': {
  				'0%': {
  					transform: 'scaleX(0)',
  					opacity: '0'
  				},
  				'100%': {
  					transform: 'scaleX(1)',
  					opacity: '1'
  				}
  			}
  		},
  		animation: {
  			'pulse-soft': 'pulse-soft 2.2s ease-in-out infinite',
  			'stamp-in': 'stamp-in 0.35s ease-out',
  			'line-reveal': 'line-reveal 0.5s ease-out'
  		}
  	}
  },
  plugins: [animate, typography],
}
