# What version 0.2.0 added, one section per change. In the demo, the
# syntax tree next to the editor shows the nodes that each one produces.

# Regexes are highlighted inside: the literals, and the bodies of
# token, rule and regex declarations.
my $date = rx/ ^ (\d ** 4) '-' <[01]> \d $ /;
say "ok" if "2026-10-07" ~~ / <alpha>+ | \d+ % ',' /;
my $s = "a,b";
$s ~~ s/ <[,;]> \s* /, /;

grammar Config {
    token TOP   { <line>* %% \n }
    token line  { <key> \h* '=' \h* <value>  # a comment
                }
    token key   { <[a..z]> \w* }
    token value { \d+ { make +$/ } | <-[\n]>* }
}

# multi, proto and only declare a sub without the word sub.
proto area(|) {*}
multi area($r) { pi * $r ** 2 }
multi area($w, $h)
{
    $w * $h
}

# The text of a qq:to heredoc interpolates.
my %user = name => "Camelia", langs => <raku perl>;
say qq:to/END/;
    Hello, %user<name>!
    You know { %user<langs>.elems } languages, $date.gist() among them.
    END

# «…» and <<…>> interpolate, and can be a subscript.
my $key = "name";
my @words = «$key "two words" { 1 + 1 }»;
say %user«$key», :list<<a $key>>;

# Quote adverbs switch kinds of interpolation on and off.
say q:c[only {1 + 2} is code, $key is not];
say qq:!s[no $scalars here, but {$key}];
say qq:c(False)[{not code}], q {a bracket after a blank};
say qq[a quote can hold [its own delimiters, and $key] in pairs];

# An operator referred to as a routine.
sub infix:<+++>($a, $b) { $a + $b + 1 }
say &infix:<+++>(1, 2), &infix:<+>(1, 2);
say [1, 2, 3].reduce(&infix:<*>);

# Keywords that are routines, called with parentheses, are plain names.
# After a built-in term, a slash divides.
say not(False), pi /2, now - time;

# Completion offers the names that the document declares. Type a `$` in
# the block of sort to get $^left and $^right, or a `.` after shape to
# get corners and name.
my \shape = class { method corners { 4 }; method name { "square" } }.new;
say <b c a>.sort({ $^left cmp $^right }), shape.corners;

# A line that continues a statement is indented: press Enter after the
# `+`, or before the trait.
my $total = 1 +
    2;
sub exported($a)
    is export
{
    $a
}

=begin pod

=head1 Pod is highlighted inside

Directives, headings and formatting codes: B<bold>, I<italic>,
C<code>, L<a link|https://raku.org> and X<the others>.

=end pod
