import { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gray-950 text-gray-100">
      <h1 className="text-4xl font-bold tracking-tight">
        Vite + React + <span className="text-sky-400">Tailwind CSS</span>
      </h1>
      <button
        type="button"
        onClick={() => setCount((count) => count + 1)}
        className="rounded-lg bg-sky-500 px-6 py-2.5 font-medium text-white transition hover:bg-sky-400 active:scale-95"
      >
        count is {count}
      </button>
      <p className="text-sm text-gray-400">
        Edit <code className="rounded bg-gray-800 px-1.5 py-0.5">src/App.tsx</code> and save to test HMR
      </p>
    </div>
  )
}

export default App
