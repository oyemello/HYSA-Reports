const BASE = (import.meta.env?.BASE_URL ?? '').replace(/\/$/, '') + '/';
const card = document.getElementById('fed-peer-card');
const svg = document.getElementById('fed-peer-chart') as SVGSVGElement | null;
const fedToggle = document.getElementById('toggle-fed') as HTMLInputElement | null;
const peerToggle = document.getElementById('toggle-peers') as HTMLInputElement | null;

if (card && svg && fedToggle && peerToggle) {
  const width = 800;
  const height = 320;
  const margin = { top: 24, right: 24, bottom: 40, left: 64 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const create = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  };

  const fetchJson = async <T,>(path: string): Promise<T | null> => {
    try {
      const res = await fetch(`${BASE}${path}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      return (await res.json()) as T;
    } catch (error) {
      console.warn(`Unable to load ${path}`, error);
      return null;
    }
  };

  const render = async () => {
    const macro = await fetchJson<{ macros?: Record<string, Array<{ date: string; value: number }>> }>('macro.json');
    const hysa = await fetchJson<{ as_of: string; peer_median: number; peer_p75: number }>('hysa.json');
    if (!macro || !macro.macros) {
      svg.appendChild(create('text', { x: String(width / 2), y: String(height / 2), 'text-anchor': 'middle', fill: '#fff' }));
      svg.textContent = 'Macro data unavailable';
      return;
    }

    const series = macro.macros.EFFR ?? macro.macros.FEDFUNDS ?? [];
    const today = new Date();
    const start = new Date(today);
    start.setFullYear(today.getFullYear() - 10);
    const fedPoints = series
      .map(({ date, value }) => ({ date: new Date(date), value }))
      .filter((pt) => Number.isFinite(pt.value) && pt.date.getTime() >= start.getTime() && pt.date.getTime() <= today.getTime());

    if (!fedPoints.length) {
      svg.textContent = 'Insufficient Fed data to render chart.';
      return;
    }

    const values: number[] = fedPoints.map((pt) => pt.value);
    const peerMedian = Number.isFinite(hysa?.peer_median) ? hysa!.peer_median : null;
    const peerP75 = Number.isFinite(hysa?.peer_p75) ? hysa!.peer_p75 : null;
    if (peerMedian !== null) values.push(peerMedian);
    if (peerP75 !== null) values.push(peerP75);

    const yMin = Math.min(...values) - 0.25;
    const yMax = Math.max(...values) + 0.25;
    const xMin = start.getTime();
    const xMax = today.getTime();
    const toX = (date: Date) => margin.left + ((date.getTime() - xMin) / (xMax - xMin)) * innerWidth;
    const toY = (value: number) => margin.top + (1 - (value - yMin) / (yMax - yMin || 1)) * innerHeight;

    const clearChildren = (node: SVGSVGElement) => {
      while (node.firstChild) node.removeChild(node.firstChild);
    };
    clearChildren(svg);

    svg.append(create('rect', { x: String(margin.left), y: String(margin.top), width: String(innerWidth), height: String(innerHeight), fill: 'transparent', stroke: 'rgba(255,255,255,0.1)' }));

    const axisGroup = create('g', { 'stroke-width': '1', stroke: 'rgba(255,255,255,0.25)' });
    axisGroup.append(create('line', { x1: String(margin.left), y1: String(height - margin.bottom), x2: String(width - margin.right), y2: String(height - margin.bottom) }));
    axisGroup.append(create('line', { x1: String(margin.left), y1: String(margin.top), x2: String(margin.left), y2: String(height - margin.bottom) }));

    const yearTickStep = 2;
    for (let year = start.getFullYear(); year <= today.getFullYear(); year += yearTickStep) {
      const date = new Date(year, 0, 1);
      if (date.getTime() < xMin || date.getTime() > xMax) continue;
      const x = toX(date);
      axisGroup.append(create('line', { x1: String(x), y1: String(height - margin.bottom), x2: String(x), y2: String(height - margin.bottom + 6) }));
      const label = create('text', { x: String(x), y: String(height - margin.bottom + 20), 'text-anchor': 'middle', fill: 'rgba(255,255,255,0.6)', 'font-size': '10' });
      label.textContent = String(year);
      axisGroup.append(label);
    }

    const yTicks = 5;
    for (let i = 0; i <= yTicks; i += 1) {
      const value = yMin + ((yMax - yMin) / yTicks) * i;
      const y = toY(value);
      axisGroup.append(create('line', { x1: String(margin.left - 6), y1: String(y), x2: String(width - margin.right), y2: String(y), 'stroke-dasharray': '2,4' }));
      const label = create('text', { x: String(margin.left - 10), y: String(y + 4), 'text-anchor': 'end', fill: 'rgba(255,255,255,0.6)', 'font-size': '10' });
      label.textContent = `${value.toFixed(2)}%`;
      axisGroup.append(label);
    }
    svg.append(axisGroup);

    const fedGroup = create('g', { class: 'fed-series' });
    const pathD = fedPoints
      .map((pt, index) => `${index === 0 ? 'M' : 'L'}${toX(pt.date)} ${toY(pt.value)}`)
      .join(' ');
    fedGroup.append(create('path', { d: pathD, fill: 'none', stroke: '#4fd1ff', 'stroke-width': '2.5' }));
    svg.append(fedGroup);

    const peerGroup = create('g', { class: 'peer-series' });
    if (peerMedian !== null) {
      peerGroup.append(create('circle', { cx: String(toX(today)), cy: String(toY(peerMedian)), r: '5', fill: '#6ee7b7' }));
    }
    if (peerP75 !== null) {
      peerGroup.append(create('circle', { cx: String(toX(today) - 14), cy: String(toY(peerP75)), r: '5', fill: '#fcd34d' }));
    }
    svg.append(peerGroup);

    const syncVisibility = () => {
      fedGroup.classList.toggle('series-hidden', !fedToggle.checked);
      peerGroup.classList.toggle('series-hidden', !peerToggle.checked);
    };
    fedToggle.addEventListener('change', syncVisibility);
    peerToggle.addEventListener('change', syncVisibility);
    syncVisibility();
  };

  render();
}
