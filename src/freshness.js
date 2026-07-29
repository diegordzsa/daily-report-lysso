// Saber si un dia ya cerro en la timezone de la cuenta publicitaria y cuantas
// horas lleva cerrado. Meta sigue agregando gasto durante horas despues del
// cierre: publicar antes de tiempo subestima el spend e infla ROAS y MER.

function partsInZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return parts;
}

// Offset de la zona respecto a UTC, en ms, para el instante dado.
function zoneOffsetMs(date, timeZone) {
  const p = partsInZone(date, timeZone);
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  // Las partes formateadas tienen resolucion de segundo; alineamos el instante.
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Instante UTC que corresponde a una medianoche local en la zona dada.
function localMidnightToUtc(year, month, day, timeZone) {
  const naive = Date.UTC(year, month - 1, day);
  const offset = zoneOffsetMs(new Date(naive), timeZone);
  const instant = naive - offset;
  // Cerca de un cambio de horario el primer offset puede ser el del lado
  // equivocado del salto; recalculamos sobre el instante ya corregido.
  const corrected = zoneOffsetMs(new Date(instant), timeZone);
  return corrected === offset ? instant : naive - corrected;
}

// Instante UTC en que termina `dateStr` (YYYY-MM-DD) en `timeZone`, o sea la
// medianoche que abre el dia siguiente.
export function dayCloseInstant(dateStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return localMidnightToUtc(
    next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone,
  );
}

// Horas transcurridas desde que cerro `dateStr` en `timeZone`.
// Negativo si el dia todavia no termina.
export function hoursSinceDayClose(dateStr, timeZone, now = new Date()) {
  return (now.getTime() - dayCloseInstant(dateStr, timeZone)) / 3600000;
}

// Fecha de "ayer" en la zona dada, en formato YYYY-MM-DD.
// No se puede usar toISOString(): eso da la fecha en UTC, que a partir de las
// 22:00 Madrid (verano) ya va un dia por detras de la fecha local.
export function yesterdayInZone(timeZone, now = new Date()) {
  const p = partsInZone(now, timeZone);
  const localToday = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  return new Date(localToday - 86400000).toISOString().slice(0, 10);
}
