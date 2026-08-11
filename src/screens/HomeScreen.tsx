import AppShell from '../components/AppShell'
import Surface from '../components/Surface'
import './HomeScreen.css'

/**
 * Ticket #8 — app shell and design tokens only. No routing, no fetching,
 * no real recommendation content: those arrive in later tickets
 * (feature-list.md items 16–18). This placeholder home surface exists
 * only to prove the token layer and the translucent-material surface
 * render correctly on a real screen.
 *
 * Moved from src/App.tsx to src/screens/HomeScreen.tsx by ticket #13,
 * which introduces routing — content and markup are unchanged.
 */
function HomeScreen() {
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

export default HomeScreen
