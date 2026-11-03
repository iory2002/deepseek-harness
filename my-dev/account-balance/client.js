/**
 * Browser half of the account-balance bundle.
 *
 * Renders one chip into `conversation.composer.dock`, to the right of the
 * statistics row and after the hardcoded context meter. The chip shows the
 * session's estimated spend and the account balance; hovering or focusing it
 * previews the split, and an activation pins the preview open.
 *
 * Everything comes from the slot's standard props plus the host half's
 * `/api/account-balance` route. No Harness Client package is imported: the
 * preview control is a local copy of the host's hover-card behavior, renamed
 * and reduced to the `--dsw-alias-*` tokens.
 */

window.__ModuleLoader__.load({
  id: '@local/account-balance',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const {
      useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
    } = React;

    /** Locale namespace owned by this plugin. */
    const NS = 'account-balance';
    /** Document-relative form of the host route; `/api/...` is not fetchable as written. */
    const ROUTE = 'api/account-balance';
    /** Hover dwell before the preview opens, and the grace period after a leave. */
    const OPEN_DELAY_MS = 150;
    const CLOSE_GRACE_MS = 150;
    /** Preview geometry, matching the host stat dialog's clamp: 300px panel, 12px viewport margin, 8px gap. */
    const CARD_WIDTH = 300;
    const CARD_GAP = 8;
    const VIEWPORT_MARGIN = 12;
    /** Tokens per pricing unit; the price table stores CNY per million tokens. */
    const TOKENS_PER_UNIT = 1e6;

    const ZH = {
      balance: '余额',
      toppedUp: '充值余额',
      granted: '赠送余额',
      estimate: '按会话累计 token 估算，仅供参考',
      stale: '上次刷新失败，显示的是上一次成功的值',
      insufficient: '账户余额不足，API 调用可能失败',
      low: '余额低于提醒阈值',
      details: '账户明细',
      unavailable: '余额不可用',
      noKey: '未配置 API key，无法查询余额',
    };
    const EN = {
      balance: 'Balance',
      toppedUp: 'Topped-up',
      granted: 'Granted',
      estimate: 'Estimated from session token totals; for reference only',
      stale: 'Last refresh failed; showing the last successful value',
      insufficient: 'Account balance is insufficient for API calls',
      low: 'Balance below the warning threshold',
      details: 'Account details',
      unavailable: 'Balance unavailable',
      noKey: 'No API key configured, so the balance cannot be queried',
    };

    const CSS = `
.ab-root { order: 1; display: flex; align-items: center; }
.ab-divider { color: var(--dsw-alias-label-tertiary); margin-right: 8px; user-select: none; }
.ab-chip {
  display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box;
  padding: 1px 8px; margin: 0;
  border: 0; border-radius: 999px; background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit; font-size: 12px; line-height: 20px; white-space: nowrap;
  font-variant-numeric: tabular-nums; cursor: pointer;
}
.ab-chip:hover, .ab-chip[aria-expanded='true'] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.ab-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.ab-chip[data-stale="true"] { opacity: .55; }
.ab-chip[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
.ab-chip[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.ab-sep { color: var(--dsw-alias-separator-primary); }
.ab-card {
  position: fixed; z-index: 1100; box-sizing: border-box;
  width: min(300px, calc(100vw - 24px));
  padding: 16px; border: 0;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-specific-menu);
  backdrop-filter: var(--dsw-menu-backdrop-filter);
  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px; line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}
.ab-title {
  display: flex; justify-content: space-between; gap: 16px;
  margin-bottom: 8px;
  color: var(--dsw-alias-label-primary); font-weight: 500;
}
.ab-title-value { font-variant-numeric: tabular-nums; }
.ab-rule { margin-bottom: 10px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
.ab-details {
  display: grid; grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
  gap: 6px 16px; margin: 0;
  color: var(--dsw-alias-label-tertiary);
}
.ab-details dt, .ab-details dd { min-width: 0; margin: 0; }
.ab-details dd { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; text-align: right; }
.ab-note { margin-top: 10px; color: var(--dsw-alias-label-tertiary); }
.ab-note + .ab-note { margin-top: 4px; }
.ab-note[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
.ab-note[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
`;

    /** Map a currency code to its symbol. Codes outside the two the API documents keep their own text. */
    function currencySymbol(code) {
      if (code === 'CNY') return '\u00a5';
      if (code === 'USD') return '$';
      return '';
    }

    /** The four disjoint buckets the `tokenUsage` projection carries, in pricing vocabulary. */
    function bucketsOf(totals) {
      return {
        cacheMiss: totals.uncachedInputTokens,
        output: totals.outputTokens,
        cacheHit: totals.cacheReadTokens,
        cacheWrite: totals.cacheWriteTokens,
      };
    }

    /** Per-bucket growth between two cumulative samples, never negative. */
    function deltaOf(previous, current) {
      return {
        cacheMiss: Math.max(0, current.cacheMiss - previous.cacheMiss),
        output: Math.max(0, current.output - previous.output),
        cacheHit: Math.max(0, current.cacheHit - previous.cacheHit),
        cacheWrite: Math.max(0, current.cacheWrite - previous.cacheWrite),
      };
    }

    /** The price of one bucket set under one band, in the price table's currency. */
    function priceOf(rates, buckets) {
      return (buckets.cacheMiss * rates.cacheMiss
        + buckets.cacheHit * rates.cacheHit
        + buckets.cacheWrite * rates.cacheWrite
        + buckets.output * rates.output) / TOKENS_PER_UNIT;
    }

    /**
     * Resolve the rates for one model under the band in force.
     * An unknown model yields undefined so the caller hides the figure: falling
     * back to another model's price would report a plausible but wrong number.
     */
    function ratesFor(pricing, model) {
      const key = typeof pricing.aliases?.[model] === 'string' ? pricing.aliases[model] : model;
      const entry = pricing.models?.[key];
      const rates = entry?.[pricing.band];
      if (typeof rates !== 'object' || rates === null) return undefined;
      return {
        cacheHit: Number(rates.cacheHit) || 0,
        cacheMiss: Number(rates.cacheMiss) || 0,
        cacheWrite: Number.isFinite(rates.cacheWrite) ? Number(rates.cacheWrite) : Number(rates.cacheMiss) || 0,
        output: Number(rates.output) || 0,
      };
    }

    /** The balance row to display: the price table's currency first, then whatever the API returned. */
    function pickInfo(balance, currency) {
      const infos = balance?.ok === true && Array.isArray(balance.infos) ? balance.infos : [];
      return infos.find(info => info.currency === currency) ?? infos[0] ?? null;
    }

    /**
     * Build the plugin's browser half.
     * @param {object} ctx - the Client context: slots plus the optional locale service.
     */
    function apply(ctx) {
      const locale = ctx.get('locale');
      let t;
      let subscribe;
      let getSnapshot;
      if (locale === undefined) {
        subscribe = () => () => {};
        getSnapshot = () => 0;
        t = key => EN[key] ?? key;
      } else {
        ctx.effect(() => {
          const disposers = [locale.register(NS, 'zh', ZH), locale.register(NS, 'en', EN)];
          return () => { for (const dispose of disposers) dispose(); };
        });
        t = locale.bind(NS);
        subscribe = listener => locale.subscribe(listener);
        getSnapshot = () => locale.getSnapshot();
      }

      /**
       * The chip and its preview. Every value it renders arrives through the
       * slot's standard props or through the host's `/api/account-balance`.
       */
      function AccountBalance(props) {
        const { useProjection, useSession } = props;
        // Subscribed only to re-render on a locale switch; the snapshot itself is unused.
        useSyncExternalStore(subscribe, getSnapshot);

        const totals = useProjection('tokenUsage');
        const selection = useProjection('modelSelection');
        const running = useSession(snapshot => snapshot.running);
        const model = selection?.next?.model ?? selection?.lastUsed?.model ?? null;

        const [cost, setCost] = useState(null);
        const [pricing, setPricing] = useState(null);
        const [balance, setBalance] = useState(null);
        const [threshold, setThreshold] = useState(10);
        const [stale, setStale] = useState(false);
        const [open, setOpen] = useState('closed');
        const [position, setPosition] = useState(null);

        const rootRef = useRef(null);
        const cardRef = useRef(null);
        const openTimer = useRef(null);
        const closeTimer = useRef(null);
        const pinned = useRef(false);
        const mounted = useRef(true);
        const inflight = useRef(false);
        const queued = useRef(false);
        const request = useRef(null);

        // Live inputs the refresh reads. Declared before the refresh triggers so
        // a commit updates them first, and read through refs so `refresh` keeps
        // one identity across the component's life.
        const totalsRef = useRef(null);
        const modelRef = useRef(null);
        const ledger = useRef({ seen: null, cost: null, model: null });
        useEffect(() => { totalsRef.current = totals ?? null; }, [totals]);
        useEffect(() => { modelRef.current = model; }, [model]);

        /**
         * Price whatever the session gained since the previous accepted sample,
         * using the band the host reported for this fetch. The first accepted
         * sample prices the whole existing total, so a page load starts from the
         * session's real spend instead of from zero.
         */
        const accrue = useCallback((freshPricing) => {
          const current = totalsRef.current;
          const active = modelRef.current;
          if (freshPricing === null || current === null || active === null) return;
          const rates = ratesFor(freshPricing, active);
          if (rates === undefined) { setCost(null); return; }
          const buckets = bucketsOf(current);
          const state = ledger.current;
          if (state.seen === null || state.model !== active) state.cost = priceOf(rates, buckets);
          else state.cost += priceOf(rates, deltaOf(state.seen, buckets));
          state.seen = buckets;
          state.model = active;
          setCost(state.cost);
        }, []);

        /** One round trip: publish the fresh price table and balance, then price what accrued. */
        const loadOnce = useCallback(async () => {
          request.current?.abort();
          const controller = new AbortController();
          request.current = controller;
          let payload;
          try {
            const response = await fetch(ROUTE, { signal: controller.signal });
            if (!response.ok) throw new Error(String(response.status));
            payload = await response.json();
          } catch (error) {
            // An aborted request was replaced by a newer one; only a real
            // failure marks the displayed values stale.
            if (!controller.signal.aborted && mounted.current) setStale(true);
            return;
          }
          if (!mounted.current) return;
          setStale(false);
          setPricing(payload.pricing ?? null);
          setBalance(payload.balance ?? null);
          if (Number.isFinite(payload.threshold)) setThreshold(payload.threshold);
          accrue(payload.pricing ?? null);
        }, [accrue]);

        // Refreshes coalesce instead of overlapping: two in flight at once would
        // each price the same token delta and double the reported spend.
        const refresh = useCallback(async () => {
          if (inflight.current) { queued.current = true; return; }
          inflight.current = true;
          try {
            do {
              queued.current = false;
              await loadOnce();
            } while (queued.current && mounted.current);
          } finally {
            inflight.current = false;
          }
        }, [loadOnce]);

        useEffect(() => {
          mounted.current = true;
          return () => {
            mounted.current = false;
            request.current?.abort();
            clearTimeout(openTimer.current);
            clearTimeout(closeTimer.current);
          };
        }, []);

        // Refresh points: entering the view, the end of a turn, and a model
        // switch. There is no timer, so an idle page makes no requests.
        useEffect(() => { void refresh(); }, [refresh]);
        useEffect(() => { if (!running) void refresh(); }, [running, refresh]);
        useEffect(() => { void refresh(); }, [model, refresh]);
        useEffect(() => { if (totals !== undefined) void refresh(); }, [totals, refresh]);

        const closeNow = useCallback(() => {
          pinned.current = false;
          clearTimeout(openTimer.current);
          clearTimeout(closeTimer.current);
          setOpen('closed');
        }, []);

        const scheduleClose = useCallback(() => {
          if (pinned.current) return;
          clearTimeout(openTimer.current);
          clearTimeout(closeTimer.current);
          closeTimer.current = setTimeout(() => {
            if (!pinned.current) setOpen('closed');
          }, CLOSE_GRACE_MS);
        }, []);

        const scheduleOpen = useCallback(() => {
          clearTimeout(closeTimer.current);
          if (open !== 'closed') return;
          clearTimeout(openTimer.current);
          openTimer.current = setTimeout(() => { setOpen('hover'); }, OPEN_DELAY_MS);
        }, [open]);

        // Place the preview against the chip's live rect. It is position:fixed so
        // it escapes the composer's clipping without a portal, which needs no
        // `react-dom` from the module table.
        useLayoutEffect(() => {
          if (open === 'closed') return undefined;
          const place = () => {
            const element = rootRef.current;
            if (element === null) return;
            const rect = element.getBoundingClientRect();
            const width = Math.min(CARD_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
            setPosition({
              left: Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN)),
              bottom: Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.top + CARD_GAP),
              width,
            });
          };
          place();
          window.addEventListener('scroll', place, true);
          window.addEventListener('resize', place);
          return () => {
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
          };
        }, [open]);

        // Escape and an outside press dismiss a pinned preview.
        useEffect(() => {
          if (open === 'closed') return undefined;
          const onKeyDown = event => { if (event.key === 'Escape') closeNow(); };
          const onPointerDown = event => {
            if (rootRef.current?.contains(event.target) === true) return;
            if (cardRef.current?.contains(event.target) === true) return;
            closeNow();
          };
          window.addEventListener('keydown', onKeyDown);
          document.addEventListener('pointerdown', onPointerDown);
          return () => {
            window.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown);
          };
        }, [open, closeNow]);

        const currency = typeof pricing?.currency === 'string' ? pricing.currency : 'CNY';
        const symbol = currencySymbol(currency);
        const info = pickInfo(balance, currency);
        const budget = info === null ? null : Number(info.totalBalance);

        if (cost === null && info === null) return null;

        const hard = balance?.ok === true && balance.isAvailable === false;
        const soft = !hard && budget !== null && Number.isFinite(budget) && budget < threshold;
        const tone = hard ? 'error' : soft ? 'warn' : 'normal';

        const chipText = [];
        if (cost !== null) chipText.push(`${symbol}${cost.toFixed(2)}`);
        if (info !== null) {
          if (chipText.length > 0) chipText.push(h('span', { className: 'ab-sep', key: 'sep' }, ' \u00b7 '));
          chipText.push(`${t('balance')} ${symbol}${info.totalBalance}`);
        }

        const notes = [];
        if (balance !== null && balance.ok === false) {
          notes.push(h('div', { key: 'fail', className: 'ab-note', 'data-tone': 'warn' },
            balance.reason === 'missing-key' ? t('noKey') : t('unavailable')));
        }
        if (hard) notes.push(h('div', { key: 'hard', className: 'ab-note', 'data-tone': 'error' }, t('insufficient')));
        if (soft) notes.push(h('div', { key: 'soft', className: 'ab-note', 'data-tone': 'warn' },
          `${t('low')} ${symbol}${threshold}`));
        if (stale) notes.push(h('div', { key: 'stale', className: 'ab-note' }, t('stale')));
        if (cost !== null) notes.push(h('div', { key: 'estimate', className: 'ab-note' }, t('estimate')));

        const card = open !== 'closed' && position !== null && h('div', {
          ref: cardRef,
          className: 'ab-card',
          role: 'dialog',
          'aria-label': t('details'),
          style: position,
        },
        h('div', { className: 'ab-title' },
          h('span', null, t('details')),
          info === null ? null : h('span', { className: 'ab-title-value' }, `${symbol}${info.totalBalance}`)),
        info === null ? null : h('div', { className: 'ab-rule' }),
        info === null ? null : h('dl', { className: 'ab-details' },
          h('dt', null, t('toppedUp')), h('dd', null, `${symbol}${info.toppedUpBalance}`),
          h('dt', null, t('granted')), h('dd', null, `${symbol}${info.grantedBalance}`)),
        ...notes);

        return h('span', {
          ref: rootRef,
          className: 'ab-root',
          onPointerEnter: scheduleOpen,
          onPointerLeave: scheduleClose,
          onFocus: scheduleOpen,
          onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose(); },
        },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        h('span', { className: 'ab-divider', 'aria-hidden': 'true' }, '|'),
        h('button', {
          type: 'button',
          className: 'ab-chip',
          'data-tone': tone,
          'data-stale': stale ? 'true' : undefined,
          'aria-expanded': open !== 'closed',
          onClick: () => {
            if (pinned.current) { closeNow(); return; }
            pinned.current = true;
            clearTimeout(openTimer.current);
            clearTimeout(closeTimer.current);
            setOpen('pinned');
          },
        }, ...chipText),
        card);
      }

      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'account-balance',
        order: 1,
      }, AccountBalance));
    }

    return { inject: ['slots'], apply };
  },
});
