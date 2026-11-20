# kami-dance

Cô bé nhảy múa của "Shukusei!! Loli Kami Requiem" đứng trong khung chat của Claude Code: ở chỗ trống bên phải
tin nhắn, và trên nền xanh đỏ của phần diff khi Claude sửa file. Cô đứng trên một cái bệ nhỏ, đi qua đi lại, cuộn
theo chữ.

- Ghostty và kitty: cô là ảnh thật.
- Terminal khác (Windows Terminal, ...): cô được vẽ bằng ký tự khối.

## Cần có

- Claude Code CLI, bản mới nhất.
- Chế độ toàn màn hình của Claude Code (bước 2 dưới đây bật nó).

## Cài trên Linux (Ghostty + herdr)

**1. Cài mod.** Dán vào terminal:

```sh
claude update
claude plugin install kami-dance --marketplace loilon504/kami-dance --scope user --config size=12 --config style=sextant
```

Nếu được hỏi `Add marketplace?` thì gõ `y`.

**2. Bật toàn màn hình.** Mở `claude`, gõ (chỉ cần một lần):

```
/tui fullscreen
```

**3. Bật ảnh thật khi chạy trong herdr.** Trong herdr, Claude không biết mình đang ở Ghostty, nên phải bật ảnh
bằng tay. Thêm lệnh `claude-kami`, dán dòng hợp với shell của bạn:

```sh
# bash
echo "alias claude-kami='CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 claude'" >> ~/.bashrc && source ~/.bashrc
```

```sh
# zsh
echo "alias claude-kami='CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1 claude'" >> ~/.zshrc && source ~/.zshrc
```

Từ giờ trong herdr gõ `claude-kami` thay cho `claude`. Mở Claude thẳng trong Ghostty (không qua herdr) thì gõ
`claude` như thường.

Ảnh động cần card đồ họa. Ghostty chạy không có card đồ họa (ví dụ trong WSL) sẽ tốn nhiều CPU: khi đó dùng
`claude` thường (cô vẽ bằng ký tự khối) hoặc tắt cô bằng `/dance off`.

## Cài trên Windows (Claude Code CLI)

**1. Cài mod.** Dán vào PowerShell hoặc Windows Terminal:

```powershell
claude update
claude plugin install kami-dance --marketplace loilon504/kami-dance --scope user --config size=12 --config style=sextant
```

Nếu được hỏi `Add marketplace?` thì gõ `y`.

**2. Bật toàn màn hình.** Mở `claude`, gõ (chỉ cần một lần):

```
/tui fullscreen
```

Windows Terminal vẽ cô bằng ký tự khối. Nếu thấy ô vuông hay dấu hỏi thay cho hình, font của bạn thiếu ký tự đó:
gõ `/dance-styles` để xem kiểu nào hiện đúng, rồi đổi sang kiểu đó, ví dụ `/dance half` (kiểu `half` hiện được ở
mọi nơi).

## Dùng

Gõ trong Claude:

| Gõ | Tác dụng |
|---|---|
| `/dance` | bật hoặc tắt cô bé |
| `/dance on`, `/dance off` | bật, tắt |
| `/dance 12` | cao 12 dòng (từ 3 đến 15) |
| `/dance sextant` | kiểu vẽ: `half`, `sextant`, `octant`, `braille` |
| `/dance 12 sextant` | đổi cả hai |
| `/dance-styles` | xem các kiểu vẽ cạnh nhau |

Cỡ và kiểu được lưu lại, dùng cho mọi phiên sau.

## Cô bé hiện ở đâu

- Bên phải tin nhắn, ở chỗ trống đủ cao: cao 12 dòng thì cần 13 dòng trống (thêm một dòng cho bệ). Cỡ nhỏ hơn thì
  cô hiện thường xuyên hơn.
- Trong diff khi Claude sửa file, đứng trên nền xanh hoặc hồng của các dòng được thêm, bớt.
- Có dòng chữ dài ngay dưới thì bệ đặt lên dòng chữ đó.
- Chỗ của cô cuộn ra khỏi màn hình thì cô sang chỗ khác đang hiện.

## Theme sáng và tối

Màu nền sau lưng cô trong diff được làm cho theme sáng và theme tối. Theme `auto` được coi là sáng. Terminal nền
tối thì chọn theme tối: gõ `/config`, mục Theme, chọn Dark.

## Cập nhật và gỡ

```sh
claude plugin update kami-dance@kami-dance
```

Cập nhật xong thì mở lại Claude. Gỡ:

```sh
claude plugin uninstall kami-dance@kami-dance
```

## Khi cô không hiện

Mở Claude kèm nhật ký của mod, rồi xem file đó:

```sh
# Linux
KAMI_DANCE_LOG=/tmp/kami-dance.log claude
```

```powershell
# Windows PowerShell
$env:KAMI_DANCE_LOG = "$env:TEMP\kami-dance.log"; claude
```

Nhật ký ghi cỡ hình đã nạp, từng tin nhắn và diff có chỗ đứng hay không, và cô đang đứng ở đâu.

## Cho người sửa mod

- `hooks/register.tsx`: tìm chỗ đứng, đi lại, đổi cỡ bằng `/dance`.
- `hooks/dancer.tsx`: vẽ cô bằng ký tự khối.
- `assets/png`: 418 khung hình gốc. `assets/sprites`: hình ký tự khối từng kiểu và cỡ, dựng bằng
  `tools/blocks.py`. `assets/walk-7`: khung đi từng phần tư cột ở cỡ 7 cho ảnh thật, dựng bằng `tools/walk.py`.
- Chạy thử: `claude plugin test .` và `claude plugin validate .`
