import { createElement, lazy, type ComponentType } from "react"

export type LazyPage<P extends object = object> = ComponentType<P> & {
  /** Starts loading the screen's code. Safe to call more than once. */
  preload: () => Promise<unknown>
}

/**
 * Like React.lazy, but a screen whose code has already arrived renders straight away.
 *
 * With plain React.lazy, the first time a screen is shown it always goes through its loading
 * placeholder, even when its code is already downloaded, and React 19 then holds the placeholder
 * for about 300 ms (FALLBACK_THROTTLE_MS) before showing the screen. Measured on the coach Plans
 * and Messages tabs: their requests started about 250 ms later than a screen without the wait.
 * Here, once the code is in (opened before, preloaded in the background, or hovered on desktop),
 * the screen renders directly with no placeholder.
 */
export function lazyPage<P extends object = object>(load: () => Promise<{ default: ComponentType<P> }>): LazyPage<P> {
  let loaded: ComponentType<P> | null = null
  let pending: Promise<{ default: ComponentType<P> }> | null = null

  const preload = () => {
    if (!pending) {
      pending = load().then(
        (module) => {
          loaded = module.default
          return module
        },
        (error: unknown) => {
          // A failed download (offline for a moment) can be tried again on the next visit.
          pending = null
          throw error
        },
      )
    }
    return pending
  }

  const Lazy = lazy(preload)
  const Page = ((props: P) => (loaded ? createElement(loaded, props) : createElement(Lazy, props))) as LazyPage<P>
  Page.preload = preload
  return Page
}
