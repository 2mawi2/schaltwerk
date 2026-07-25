#!/usr/bin/env python3

import argparse
import asyncio
import base64
import json
import sys
from pathlib import Path

from computer import Computer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8002)

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("probe")
    subparsers.add_parser("screenshot")

    execute_parser = subparsers.add_parser("execute-plan")
    execute_parser.add_argument("plan_file")

    return parser.parse_args()


def decode_text(value: str) -> str:
    return base64.b64decode(value.encode("utf-8")).decode("utf-8")


async def apply_operation(computer: Computer, operation: dict) -> None:
    command = operation["command"]
    args = operation.get("args", [])
    interface = computer.interface

    if command == "click":
        x, y, button = int(args[0]), int(args[1]), args[2]
        if button == "left":
            await interface.left_click(x, y)
            return
        if button == "right":
            await interface.right_click(x, y)
            return
        raise RuntimeError(f"Unsupported Cua click button: {button}")

    if command == "double-click":
        x, y, button = int(args[0]), int(args[1]), args[2]
        if button != "left":
            raise RuntimeError(f"Unsupported Cua double-click button: {button}")
        await interface.double_click(x, y)
        return

    if command == "move":
        await interface.move_cursor(int(args[0]), int(args[1]))
        return

    if command == "drag":
        path = [
            (int(args[0]), int(args[1])),
            (int(args[2]), int(args[3])),
        ]
        await interface.drag(path)
        return

    if command == "scroll":
        x, y = int(args[0]), int(args[1])
        scroll_x, scroll_y = int(args[2]), int(args[3])
        await interface.move_cursor(x, y)
        await interface.scroll(scroll_x, scroll_y)
        return

    if command == "type":
        await interface.type_text(decode_text(args[0]))
        return

    if command == "keypress":
        shortcut = args[0]
        if "+" in shortcut:
            await interface.hotkey(*shortcut.split("+"))
            return
        await interface.press_key(shortcut)
        return

    if command == "wait":
        await asyncio.sleep(max(0, int(args[0])) / 1000)
        return

    raise RuntimeError(f"Unsupported Cua operation: {command}")


async def run() -> None:
    args = parse_args()

    async with Computer(
        os_type="linux",
        use_host_computer_server=True,
        api_host=args.host,
        api_port=args.port,
        telemetry_enabled=False,
    ) as computer:
        if args.command == "probe":
            screenshot = await computer.interface.screenshot()
            screen_size = await computer.interface.get_screen_size()
            payload = {
                "screen_size": screen_size,
                "screenshot_bytes": len(screenshot),
            }
            sys.stdout.write(json.dumps(payload))
            return

        if args.command == "screenshot":
            sys.stdout.buffer.write(await computer.interface.screenshot())
            return

        if args.command == "execute-plan":
            operations = json.loads(Path(args.plan_file).read_text())
            for operation in operations:
                await apply_operation(computer, operation)
            return

        raise RuntimeError(f"Unknown command: {args.command}")


if __name__ == "__main__":
    asyncio.run(run())
