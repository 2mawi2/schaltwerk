import { memo, useMemo } from 'react'
import type { ReactNode, ReactElement } from 'react'
import type { HistoryItemViewModel } from './types'
import { theme } from '../../common/theme'

export const SWIMLANE_HEIGHT = 22
export const SWIMLANE_WIDTH = 9
const R = 4
export const CIRCLE_RADIUS = 2.5
export const CIRCLE_STROKE_WIDTH = 1.5

function xFor(col: number) {
  return SWIMLANE_WIDTH * (col + 1)
}

function renderGraph(viewModel: HistoryItemViewModel): ReactElement {
  const svgElements: ReactNode[] = []
  const { historyItem, inputSwimlanes, outputSwimlanes, isCurrent } = viewModel

  const midY = SWIMLANE_HEIGHT / 2
  const inputIndex = inputSwimlanes.findIndex(node => node.id === historyItem.id)
  const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length

  const circleColor =
    circleIndex < outputSwimlanes.length
      ? outputSwimlanes[circleIndex].color
      : circleIndex < inputSwimlanes.length
      ? inputSwimlanes[circleIndex].color
      : '#81b88b'

  let outputSwimlaneIndex = 0

  for (let index = 0; index < inputSwimlanes.length; index++) {
    const color = inputSwimlanes[index].color

    if (inputSwimlanes[index].id === historyItem.id) {
      if (index !== circleIndex) {
        const x1 = xFor(index)
        const xCircle = xFor(circleIndex)
        const d = [
          `M ${x1} 0`,
          `Q ${x1} ${SWIMLANE_WIDTH} ${x1 - SWIMLANE_WIDTH} ${SWIMLANE_WIDTH}`,
          `H ${xCircle}`
        ].join(' ')
        svgElements.push(
          <path
            key={`current-move-${index}`}
            d={d}
            stroke={color}
            strokeWidth={1}
            fill="none"
            strokeLinecap="round"
          />
        )
      } else {
        outputSwimlaneIndex++
      }
    } else {
      if (outputSwimlaneIndex < outputSwimlanes.length &&
          inputSwimlanes[index].id === outputSwimlanes[outputSwimlaneIndex].id) {
        if (index === outputSwimlaneIndex) {
          svgElements.push(
            <path
              key={`through-${index}`}
              d={`M ${xFor(index)} 0 V ${SWIMLANE_HEIGHT}`}
              stroke={color}
              strokeWidth={1}
              fill="none"
              strokeLinecap="round"
            />
          )
        } else {
          const x1 = xFor(index)
          const x2 = xFor(outputSwimlaneIndex)
          const d = [
            `M ${x1} 0`,
            `V 6`,
            `Q ${x1} ${midY - R} ${x1 - R} ${midY}`,
            `H ${x2 + R}`,
            `Q ${x2} ${midY} ${x2} ${midY + R}`,
            `V ${SWIMLANE_HEIGHT}`
          ].join(' ')
          svgElements.push(
            <path
              key={`curve-${index}-${outputSwimlaneIndex}`}
              d={d}
              stroke={color}
              strokeWidth={1}
              fill="none"
              strokeLinecap="round"
            />
          )
        }
        outputSwimlaneIndex++
      }
    }
  }

  for (let i = 1; i < historyItem.parentIds.length; i++) {
    const parentId = historyItem.parentIds[i]
    let parentOutputIndex = -1
    for (let j = outputSwimlanes.length - 1; j >= 0; j--) {
      if (outputSwimlanes[j].id === parentId) {
        parentOutputIndex = j
        break
      }
    }

    if (parentOutputIndex !== -1) {
      const mergeColor = outputSwimlanes[parentOutputIndex].color
      const xParent = xFor(parentOutputIndex)
      const xCircle = xFor(circleIndex)

      svgElements.push(
        <path
          key={`merge-down-${i}`}
          d={`M ${xParent - SWIMLANE_WIDTH} ${midY} Q ${xParent} ${midY} ${xParent} ${SWIMLANE_HEIGHT}`}
          stroke={mergeColor}
          strokeWidth={1}
          fill="none"
          strokeLinecap="round"
        />
      )

      svgElements.push(
        <path
          key={`merge-horiz-${i}`}
          d={`M ${xParent - SWIMLANE_WIDTH} ${midY} H ${xCircle}`}
          stroke={mergeColor}
          strokeWidth={1}
          fill="none"
          strokeLinecap="round"
        />
      )
    }
  }

  if (inputIndex !== -1) {
    svgElements.push(
      <path
        key="into-circle"
        d={`M ${xFor(circleIndex)} 0 V ${midY}`}
        stroke={inputSwimlanes[inputIndex].color}
        strokeWidth={1}
        fill="none"
        strokeLinecap="round"
      />
    )
  }

  if (historyItem.parentIds.length > 0) {
    svgElements.push(
      <path
        key="out-circle"
        d={`M ${xFor(circleIndex)} ${midY} V ${SWIMLANE_HEIGHT}`}
        stroke={circleColor}
        strokeWidth={1}
        fill="none"
        strokeLinecap="round"
      />
    )
  }

  const nodeCx = xFor(circleIndex)
  const nodeCy = midY

  if (isCurrent) {
    svgElements.push(
      <circle
        key="node-head-outer"
        cx={nodeCx}
        cy={nodeCy}
        r={CIRCLE_RADIUS + 3}
        stroke={circleColor}
        strokeWidth={CIRCLE_STROKE_WIDTH}
        fill={circleColor}
        filter="url(#node-shadow)"
      />
    )
    svgElements.push(
      <circle
        key="node-head-inner"
        cx={nodeCx}
        cy={nodeCy}
        r={CIRCLE_STROKE_WIDTH}
        stroke={circleColor}
        strokeWidth={CIRCLE_RADIUS}
        fill={theme.colors.background.primary}
      />
    )
  } else if (historyItem.parentIds.length > 1) {
    svgElements.push(
      <circle
        key="node-merge-outer"
        cx={nodeCx}
        cy={nodeCy}
        r={CIRCLE_RADIUS + 2}
        stroke={circleColor}
        strokeWidth={CIRCLE_STROKE_WIDTH}
        fill={circleColor}
        filter="url(#node-shadow)"
      />
    )
    svgElements.push(
      <circle
        key="node-merge-inner"
        cx={nodeCx}
        cy={nodeCy}
        r={CIRCLE_RADIUS - 1}
        stroke={circleColor}
        strokeWidth={CIRCLE_STROKE_WIDTH}
        fill={theme.colors.background.primary}
      />
    )
  } else {
    svgElements.push(
      <circle
        key="node"
        cx={nodeCx}
        cy={nodeCy}
        r={CIRCLE_RADIUS + 1}
        stroke={circleColor}
        strokeWidth={CIRCLE_STROKE_WIDTH}
        fill={circleColor}
        filter="url(#node-shadow)"
      />
    )
  }

  const width = SWIMLANE_WIDTH * (Math.max(inputSwimlanes.length, outputSwimlanes.length, 1) + 1)

  return (
    <svg
      className="graph git-graph"
      width={width}
      height={SWIMLANE_HEIGHT}
      viewBox={`0 0 ${width} ${SWIMLANE_HEIGHT}`}
      role="presentation"
    >
      <defs>
        <filter id="node-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.3" />
        </filter>
      </defs>
      {svgElements}
    </svg>
  )
}

interface GitGraphRowProps {
  viewModel: HistoryItemViewModel
}

export const GitGraphRow = memo(({ viewModel }: GitGraphRowProps) => {
  return useMemo(() => renderGraph(viewModel), [viewModel])
})

GitGraphRow.displayName = 'GitGraphRow'
