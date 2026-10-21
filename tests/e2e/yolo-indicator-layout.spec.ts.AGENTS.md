# yolo-indicator-layout.spec.ts — index

L3 YOLO bar tint + composer strip layout (single line, row height, floor, hu >= zh-CN, 18-combo contrast, hover/keyboard/touch paths, hu catalogue faults). Test-plan #E1-#E8, #E19-#E21, #F8-#F12, #X1-#X3. See change: fix-yolo-indicator-overflow.

add-composer-dock: strip = dock footer (`yolo-composer-strip`, fixed 32 px `h-8`); E3–E7/E20 assert 32 px and drive the dock width (lanes hidden); new serial block: #F9 (12-row Processes lane, footer inside dock+viewport at every scroll position) and #F10 (32 px, time visible, link name = description, no live-region ancestor; 375/768/1500 × en/hu × scoped/unscoped). See change: add-composer-dock.
