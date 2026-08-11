import AppShell from './components/AppShell'
import Surface from './components/Surface'
import './App.css'

/**
 * Ticket #8 — app shell and design tokens only. No routing, no fetching,
 * no real recommendation content: those arrive in later tickets
 * (feature-list.md items 16–18). This placeholder home surface exists
 * only to prove the token layer and the translucent-material surface
 * render correctly on a real screen.
 */
function App() {
  return (
    <AppShell>
      <header className="home-mark">FPL Advisor</header>

      <Surface className="home-demo">
        <p className="home-demo__label">Design tokens</p>
        <p className="home-demo__figure num">£100.0m</p>
        <p className="home-demo__caption">
          Example figure — later screens replace this with your squad value.
        </p>
      </Surface>
    </AppShell>
  )
}

export default App
