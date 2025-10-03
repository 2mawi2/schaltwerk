use vt100::Parser;

pub struct VisibleScreen {
    parser: Parser,
}

impl VisibleScreen {
    pub fn new(rows: u16, cols: u16) -> Self {
        Self {
            parser: Parser::new(rows, cols, 0),
        }
    }

    pub fn feed_bytes(&mut self, bytes: &[u8]) {
        self.parser.process(bytes);
    }

    pub fn hash_tail_lines(&self, n: usize) -> String {
        let screen = self.parser.screen();
        let contents = screen.contents();
        let lines: Vec<&str> = contents.lines().collect();
        let start_idx = lines.len().saturating_sub(n);
        lines[start_idx..].join("\n")
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.set_size(rows, cols);
    }

    pub fn cursor_position(&self) -> (u16, u16) {
        self.parser.screen().cursor_position()
    }
}
