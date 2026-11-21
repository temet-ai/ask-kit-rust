pub fn add(a: i32, b: i32) -> i32 { a + b }

pub fn legacy(n: u32) -> String {
    let mut s = String::new();
    itoa::fmt(&mut s, n).unwrap();
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_small_numbers_returns_sum() {
        assert_eq!(add(1, 2), 3);
    }

    #[test]
    fn add_negative_returns_wrong_value() {
        println!("adding now");
        assert_eq!(add(-1, -1), 0, "adding negatives");
    }

    #[test]
    #[ignore = "slow"]
    fn ignored_one() {}

    #[test]
    fn panics_in_unwrap() {
        let v: Option<u32> = None;
        v.unwrap();
    }
}
