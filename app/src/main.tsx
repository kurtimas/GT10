import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import '@shared/src/index.css'
import { TRPCProvider } from "@shared/src/providers/trpc"
import { SiteProvider } from "@/providers/site"
import { WeighQueueProvider } from "@/providers/weighQueue"
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TRPCProvider>
        <SiteProvider>
          <WeighQueueProvider>
            <App />
          </WeighQueueProvider>
        </SiteProvider>
      </TRPCProvider>
    </BrowserRouter>
  </StrictMode>,
)
