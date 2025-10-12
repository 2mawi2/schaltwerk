use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use vt100::Parser;

#[derive(Debug)]
pub struct ScreenSnapshot {
    pub full_hash: u64,
    pub cursor_pos: (u16, u16),
    pub rows: u16,
    pub cols: u16,
    pub contents_lines: Vec<String>,
}

pub struct VisibleScreen {
    parser: Parser,
}

impl VisibleScreen {
    pub fn new(rows: u16, cols: u16, _terminal_id: String) -> Self {
        Self {
            parser: Parser::new(rows, cols, 0),
        }
    }

    pub fn feed_bytes(&mut self, bytes: &[u8]) {
        self.parser.process(bytes);
    }

    pub fn take_snapshot(&self) -> ScreenSnapshot {
        let screen = self.parser.screen();
        let contents = screen.contents();
        let cursor_pos = screen.cursor_position();
        let (rows, cols) = screen.size();

        let mut hasher = DefaultHasher::new();
        contents.hash(&mut hasher);
        cursor_pos.hash(&mut hasher);
        rows.hash(&mut hasher);
        cols.hash(&mut hasher);
        let full_hash = hasher.finish();

        ScreenSnapshot {
            full_hash,
            cursor_pos,
            rows,
            cols,
            contents_lines: Vec::new(),
        }
    }

    pub fn compute_full_screen_hash(&self) -> u64 {
        let screen = self.parser.screen();
        let contents = screen.contents();
        let cursor_pos = screen.cursor_position();
        let (rows, cols) = screen.size();

        let mut hasher = DefaultHasher::new();
        contents.hash(&mut hasher);
        cursor_pos.hash(&mut hasher);
        rows.hash(&mut hasher);
        cols.hash(&mut hasher);
        hasher.finish()
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.parser.screen_mut().set_size(rows, cols);
    }

    pub fn cursor_position(&self) -> (u16, u16) {
        self.parser.screen().cursor_position()
    }
}
