# What version 0.4.0 added, one section per change. Most of it was
# found by reading the test suite of mutsu, an implementation of Raku.

# Corner quotes, and the low and the reversed curly quotes.
say ｢sub not-code() { }｣, Q｢a backslash \｣, „low $*PID”, ‚low single’;
say Q♥any symbol can delimit♥, qx`echo backtick`;

# Fractions that are one character, and powers in superscript.
my $x = ½ + ⅔;
say $x², 2⁻¹ / 3;

# Symbols outside of ASCII are operators, such as the atomic ones and
# the operators of one's own.
sub infix:<⚡>($a, $b) { $a + $b }
my atomicint $count = 0;
$count ⚛+= 1;
say ⚛$count, 1 ⚡ 2, 3 ≠ 4;

# The set operators that are written in parentheses.
my $set = <a b c>.Set;
say <a b> (<=) $set, 'a' (elem) $set, $set (|) <d>, $set (-) <a>;

# An operator in brackets as a routine.
say [1, 2, 3].reduce(&[+]), &[max](1, 2), &[»+»]((1, 2), 1);

# The name of an operator in double angles.
sub infix:<< plus-one >> ($a, $b) { $a + $b + 1 }
say &infix:<< plus-one >>(1, 2), &infix:<<(>=)>>($set, <a>);

# A constant with a sigil has a ConstantName, like one without.
constant LIMIT = 10;
my constant $SMALL = 3;
constant @PRIMES = 2, 3, 5;
our constant %NAMES = one => 1;

# Declarator comments with brackets, which can span lines.
#|( What the routine after this comment
    is for. )
sub documented { }
#={ and what it was for }

grammar Words {
    # The :sym<...> of a name can come after blanks.
    proto token word {*}
    token word :sym<short> { \w ** 1..3 }
    token word :sym<long> { \w+ }

    # A declaration in a regex is code up to its semicolon.
    token counted { (\w) :my $first = $/; \w* { make $first } }
}

# In a regex: the other quotes, a list of words, and code in the
# arguments of an assertion.
say "it's" ~~ / ｢it's｣ | ‘a/b’ | „c/d” /;
say "b" ~~ / < a ' b > /;
say "x" ~~ / <word: /\w<alpha>*/ > | <:name(/LATIN/)> | <+:Lu +:name(/SMALL/)> /;
say "1" ~~ m/ (\d) <?{ $/[0] < 5 }> /;
say "ab" ~~ / a { say $¢.pos } b /;

# The match variable in the replacement of a substitution.
my $s = "abc";
$s ~~ s/(b)/[$/]/;
say $s, 1 / 2;
