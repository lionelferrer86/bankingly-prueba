# Generador de Reporte Ejecutivo - Tickets TAM

Script que procesa el dataset de tickets (`../data.json`) y genera un reporte ejecutivo automático.

## Requisitos

- Node.js 18+ (soporta ES modules)

## Uso

```bash
node generate-report.js
```

El reporte se genera en `output/reporte-ejecutivo.html` — HTML estático con CSS inline, listo para compartir.

## Contenido del reporte

1. **Agrupaciones**
   - Por severidad (Critical, High, Medium, Low)
   - Por estado (Open, Closed, In Progress, Escalated, Waiting for Client)
   - Por categoría (Production Incident, Certification Issue, etc.)

2. **TTR (Tiempo de Resolución)**
   - Promedio para tickets **Critical** y **High** cerrados
   - *Calculado desde `closed_at` - `created_at`*

3. **Clientes en riesgo**
   - Clientes con tickets Critical/High abiertos o en progreso
   - Clientes con tickets escalados
   - Clientes con Critical sin workaround disponible
