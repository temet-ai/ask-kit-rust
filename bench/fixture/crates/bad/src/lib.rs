pub fn shout(s: &str) -> String {
    let unused = 3;
    s.to_uppercase()
}

pub fn render(n: u32) -> String {
    let mut buf = itoa::Buffer::new();
    buf.format(n).to_string()
}

#[cfg(feature = "err")]
pub fn broken() -> u32 {
    let x: u32 = "five";
    missing_fn(x)
}

#[cfg(feature = "lint")]
pub fn linty(v: &Vec<u32>) -> bool {
    if v.len() == 0 {
        return true;
    }
    false
}
