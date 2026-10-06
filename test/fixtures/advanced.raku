# Written for this repository as a smoke test for quotes, regexes, Pod
# and operators. It has to parse without error nodes.
use v6.d;

=begin pod

=head1 NAME

Log::Parse - the users' favourite { log parser

=head1 SYNOPSIS

    my $entry = Log::Parse.parse('2026-01-02 ERROR disk "full"');

=end pod

unit module Log::Parse;

enum Level <DEBUG INFO WARN ERROR>;

grammar Line {
    token TOP { <date> \s+ <level> \s+ <message> }
    token date { \d ** 4 '-' \d ** 2 '-' \d ** 2 }
    token level { <[A..Z]>+ }
    token message { [ <quoted> | <-["]>+ ]* }
    token quoted { '"' ~ '"' <-["]>* }
    rule pair { <key=.ident> '=' <value> { make $<key>.Str => $<value>.made } }
    regex value { \S+ | "{" .*? "}" }
    token op:sym<eq> { '==' }
}

class Actions {
    method TOP($/) { make %( date => ~$<date>, level => Level::{~$<level>}, text => ~$<message> ) }
}

#| Parses one line, or returns Nil.
sub parse(Str:D $line --> Hash) is export {
    my $match = Line.parse($line, actions => Actions.new) or return Nil;
    $match.made
}

sub is-noise(Str $text) {
    return True if $text ~~ / ^ \s* $ /;
    return True if $text ~~ m:i/ 'heartbeat' | 'ping' /;
    $text.chars / 2 < 3
}

sub normalize(Str $text is copy) {
    $text ~~ s:g/ \s+ / /;
    $text .= subst(/ ^ \s+ /, '');
    $text = $text.trans('A'..'Z' => 'a'..'z');
    $text ~~ tr/\t/ /;
    $text
}

sub summary(@entries) {
    my %count;
    %count{.<level>}++ for @entries;
    my @levels = <DEBUG INFO WARN ERROR>;
    my $width = [max] @levels».chars;
    my $total = [+] %count.values;
    my $ratio = $total ?? %count<ERROR> / $total !! 0;
    my $report = qq:to/END/;
        Entries: $total
        Errors:  {%count<ERROR> // 0} ({($ratio * 100).round}%)
        END
    for @levels -> $level {
        $report ~= sprintf("%-{$width}s %s\n", $level, '#' x (%count{$level} // 0));
    }
    $report ~ q:to/FOOTER/
        -- end of report --
        FOOTER
}

sub render(%entry, :$color = True) {
    my @parts = %entry<date>, "[%entry<level>]", %entry<text>;
    my $line = @parts.join(' ');
    my $plain = q{no $interpolation {here}};
    my $shell = qq[echo "$line" | wc -c];
    my @pairs = %entry.keys Z=> %entry.values;
    my @grid = (1..3) X* (1..3);
    my $padded = "@parts[0] / @parts.elems() = { @parts[0].chars / @parts.elems }";
    $color ?? "\e[31m$line\e[0m" !! $line
}

multi sub infix:<+++>(Int $a, Int $b) { $a + $b + 1 }

my $n = 2 +++ 3;
my $half = $n / 2;
my $hex = :16<FF> + 0x10;
say $half < 3 ?? 'small' !! 'big';
say <a b c>.elems, ' ', (%*ENV<HOME> // '~');

# A string that spans lines, with interpolation on each of them.
my $report = "Total: $n
  half of it: { $half }
  as hex: $hex.fmt('%x')
";

# Quotes whose adverbs switch kinds of interpolation on and off.
my &plus = &infix:<+++>;
say q:c[sum: { plus(1, 2) } costs $5.00 \] ], qq:!c{ a {literal} block, $n times };
say q:s:b"$hex\t@not-an-array", Q:closure<{ $n * 2 } is not $half>, qq:!s:!b[10$ \n];

=finish

Anything after =finish is documentation: { ' " /
